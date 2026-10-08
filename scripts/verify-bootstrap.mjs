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
// package is a verifier failure. C1 added domain, storage and runtime; C2 governance; C3 mind; C5 the
// Founder Command Center surface (`command-center`) and its browser UI (`command-center-ui`).
const ALLOWED_PACKAGES = ['bootstrap-contract', 'domain', 'governance', 'mind', 'secret-vault', 'model-providers', 'tool-drivers', 'storage', 'runtime', 'command-center', 'command-center-ui'];

// C1 persistence boundary: `node:sqlite` (a Release Candidate API) is imported by exactly one module.
const SQLITE_ADAPTER = 'packages/storage/src/sqlite/connection.ts';
const SQLITE_IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"](?:node:)?sqlite['"]/;
// C1 runtime has no network surface and makes no provider calls.
const NETWORK_MODULE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|dns\/promises|undici|child_process|worker_threads)['"]|\bfetch\s*\(|\bnew\s+(?:WebSocket|XMLHttpRequest)\b/;
// Runtime dependencies of workspace packages: only sibling workspaces unless a change adds a
// reviewed exception here (no ORM, provider SDK, queue server, framework or native addon).
// C5 (D-C5-14): the browser UI is DOM and SVG on the platform alone; no renderer dependency remains
// (the `three` exception of D-C5-02 was retired with the Tree of Light surface).
const ALLOWED_RUNTIME_DEPENDENCIES = [];
const ALLOWED_PACKAGE_DEPENDENCIES = {};
// C5: the loopback Founder listener is the ONE network path in the repository, and the browser UI (which
// runs in the Founder's browser, not in the Company runtime) talks to it with fetch / EventSource.
const FOUNDER_LISTENER = 'packages/command-center/src/server/listener.ts';
const UI_SRC = 'packages/command-center-ui/src/';
// (The W3C XML namespace identifiers, e.g. the SVG namespace, are names, never fetched.)
const REMOTE_URL = /\bhttps?:\/\/(?!127\.0\.0\.1\b|localhost\b|www\.w3\.org\/)[a-z0-9.-]+/i;
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
// L1-01: the Founder-host live smoke seeds identities through the seam exactly as the acceptances do (never CI, never a product path).
const TEST_SEAM_HARNESSES = ['scripts/c2-acceptance.mjs', 'scripts/c3-acceptance.mjs', 'scripts/c4-acceptance.mjs', 'scripts/c5-acceptance.mjs', 'scripts/c5-visual-proof.mjs', 'scripts/c5/seed-company.mjs', 'scripts/c6-acceptance.mjs', 'scripts/l1-deepseek-smoke.mjs'];
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
// Released canonical migrations (C1 0001–0003, C2 0004, C3 0005–0006, C4 0007–0008, C5 0009, C6 0010) are
// frozen by content, independently of the registry pins: editing one and re-pinning it is still refused
// (R1-14: C3's were released with PR #4 and had not been added; R2-33: C4–C6's had not been added either —
// a stage's migrations join this list in the change that releases them).
const FROZEN_MIGRATIONS = [
  { file: '0001_work_foundation.sql', sha256: '3022ed5ed626f9394cfa9a7e897d2ed4e7bcb9b94c8de7a9a4bde7c0c658436e' },
  { file: '0002_queue_runs_artifacts.sql', sha256: 'b3060a1ea7a3e57e8bf0f76a4edba437c9f1b8d2886ef97ff5ca2b6920b0a7c2' },
  { file: '0003_runtime_wake_generation.sql', sha256: 'f47cf341f677585d762672929bdf2f41eeb4bf7440463b68846bac0c777762e4' },
  { file: '0004_c2_governance.sql', sha256: '51dd9a38df306751eace1dc6cf82e231b92e487b7e913b061f336e8c25a0066c' },
  { file: '0005_c3_memory_context.sql', sha256: '2c2f0d8092f108de2596c15e795ba6ba8d17b316761d0ac59e45d8845409e44a' },
  { file: '0006_c3_skills_academy.sql', sha256: 'a4b8709915fbad924212e3278b64d2f58d4d1e40c5ba1ff937cb7c50637d57d8' },
  { file: '0007_c4_organization.sql', sha256: '9c46b838c21caf7b38d5db1244fc6fdd83c5e47f1a24fe2f973a9828f417fc3b' },
  { file: '0008_c4_review_quality.sql', sha256: 'd937856f2a730ff33d3fb83f61c8e6b3ce0c932c4189492d6c50e8eeafb899f5' },
  { file: '0009_c5_founder_surface.sql', sha256: '803f9eef58fad2afaabbca562c509648aaf59cc21ad647728957fa31d6ab00b1' },
  { file: '0010_c6_improvement_engine.sql', sha256: 'a8696420f2c20abc8dfe1b62b729adedc57314cfecd7e644bc31687fa9c989ee' },
  // R2 released 0011 with PR #12 (merged 2026-09-30); it joins the frozen set in the change after its release (C7-A).
  { file: '0011_r2_integrity.sql', sha256: '97ab99eebf4fc8ce49c1e1550eb4448f8a9e515a7b02259381ab33fe95ae2550' },
  // C7-A released 0012 with PR #13 (merged 2026-10-01); it joins the frozen set in the change after its release (C7-B).
  { file: '0012_c7a_operational_data_external_outcomes.sql', sha256: '31eeff9a49e284bec44915842ea39453550cc225c9e58b100483a7ad45aaaf09' },
  // C7-B released 0013 with PR #14 (merged 2026-10-01); it joins the frozen set in the change after its release (C7-C).
  { file: '0013_c7b_governed_app_controls.sql', sha256: '6eb49123e3079c1256fc95d92c2de47582245109744995f437bb07c57f2d3610' },
  // C7-C released 0014 with PR #15 (merged 2026-10-01); it joins the frozen set in the change after its release (C7-D).
  { file: '0014_c7c_pilot_instrumentation.sql', sha256: '9efb1a03cf509b241a083c62d8167939acb7f1615f99c95d873a9b1594632216' },
  // C7-D released 0015 with PR #16 (merged 2026-10-01); it joins the frozen set in the change after its release (L1-01).
  { file: '0015_c7d_digital_presence.sql', sha256: '1e77232f876af5bf449bd96d235476a40c4d64a58f16ecdc3ce7006a1d7dc0fa' },
  // L1-01 released 0016 with PR #17 (merged 2026-10-05); it joins the frozen set in the change after its release (L1-02).
  { file: '0016_l1_provider_pricing_identity.sql', sha256: '2fc84ac5ec261c6c5423e5f517c740a7c16f1cd3d40112baf4507e19f3769685' },
];
// Later-scope / non-goal subsystems never appear: APP-OPS (C7) and dashboards / analytics tables or packages (C6
// deliberately builds reports with typed claims, never a dashboard or analytics store — its non-goals).
// The Founder Command Center, the Goal model, Founder-facing communication and Founder Attention are C5's own
// (D-C5-01: `command-center*` packages; `goals`, `communication_*`, `founder_*` tables in migration 0009).
const LATER_SCOPE_TABLE = /\bCREATE\s+(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w*(?:dashboard|app_ops|appops|performance_score|employee_score|analytics)\w*)/i;
const LATER_SCOPE_PACKAGE = /^(?:dashboards?|analytics|app-ops|appops|web-ops|webops)$/;
// --- C5 boundaries ------------------------------------------------------------------------------
const C5_REPORT = 'docs/C5_IMPLEMENTATION_REPORT.md';
const C5_CLOSURE = /^docs\/C5_[^/]*CLOSURE[^/]*\.md$/i;
const C5_PROOF_MARKERS = ['C5-PROOF: c5-kernel', 'C5-PROOF: founder-surface', 'C5-PROOF: runtime-c5', 'C5-PROOF: founder-listener', 'C5-PROOF: tree-of-light-layout'];
const C5_MUTATION_CHECK = 'scripts/c5-mutation-check.mjs';
// --- C6 boundaries (Company Improvement Engine) -------------------------------------------------------
const C6_REPORT = 'docs/C6_IMPLEMENTATION_REPORT.md';
const C6_CLOSURE = /^docs\/C6_[^/]*CLOSURE[^/]*\.md$/i;
const C7A_CLOSURE = /^docs\/C7A_[^/]*CLOSURE[^/]*\.md$/i;
const C6_PROOF_MARKERS = ['C6-PROOF: improvement-kernel', 'C6-PROOF: storage-improvement', 'C6-PROOF: storage-resilience', 'C6-PROOF: runtime-c6', 'C6-PROOF: storage-founder-free'];
const C6_MUTATION_CHECK = 'scripts/c6-mutation-check.mjs';
// Rule A for C6: evaluations, attributions, learning, reports and recovery carry ids, states, codes and counts only.
const C6_WRITERS = ['improvement', 'improvement-core', 'resilience', 'maintenance', 'update-hold'].map((m) => `packages/storage/src/${m}.ts`);
const C6_CONTENT_IN_TELEMETRY = /\b(?:appendAudit|appendEvent|\.(?:info|warn|error|debug))\s*\([^\n]*[{,]\s*(?:content|reflection|body|rationale|passphrase|text|summary|title|instructions|objective)\s*[,:}]/;
// Stage 17 Founder Decision 1: no universal employee score, rank or leaderboard — in code or in schema.
const UNIVERSAL_SCORE = /\b(?:overall|universal|employee|performance|global|total|company)_?[Ss]core\b|\bleaderboard\s*[:=(]|\b\w*_score\s+(?:INTEGER|REAL|NUMERIC|TEXT)\b/;
const RESILIENCE_MODULE = 'packages/storage/src/resilience.ts';
const EVALUATION_KERNEL = 'packages/mind/src/evaluation.ts';
const IMPROVEMENT_CORE = 'packages/storage/src/improvement-core.ts';
// --- C7-A boundaries (Operational Data + External Outcome Core) ---------------------------------------------------
const C7A_REPORT = 'docs/C7A_IMPLEMENTATION_REPORT.md';
const C7A_PROOF_MARKERS = ['C7A-PROOF: intake-kernel', 'C7A-PROOF: storage-external-evidence', 'C7A-PROOF: c6-seam-kernel', 'C7A-PROOF: runtime-c7a'];
const C7A_MUTATION_CHECK = 'scripts/c7a-mutation-check.mjs';
const OUTCOME_CORE = 'packages/storage/src/outcome-core.ts';
const EXTERNAL_CORE = 'packages/storage/src/external-core.ts';
const EXTERNAL_STORE = 'packages/storage/src/external-evidence.ts';
const INTAKE_KERNEL = 'packages/governance/src/external-evidence.ts';
// Governed source / record / binding state changes only in the C7-A storage modules (tests seed through the stores).
const EXTERNAL_WRITERS = [EXTERNAL_CORE, EXTERNAL_STORE];
const EXTERNAL_WRITE = /\b(?:UPDATE|INSERT\s+(?:OR\s+\w+\s+)?INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+external_\w+/i;
// Rule A for C7-A: an intake payload, its fields, values or producer identity never enter audit, events or logs.
const C7A_CONTENT_IN_TELEMETRY = /\b(?:appendAudit|appendEvent|sourceEvent|\.(?:info|warn|error|debug))\s*\([^\n]*[{,]\s*(?:occurrence|envelope|payload|fields|raw|body|content|text|message|value|producerEventId|sourceKey|userPseudonym|echo)\s*[,:}]/;
// The governed datastore seam every C7-A evidence table carries (code checks are re-checked by triggers): the registered
// contract held by the datastore (D-C7A-10) and the contest of a verification whose evidence a later conflict disputed
// (D-C7A-11) included.
const C7A_GOVERNED_TRIGGERS = [
  'external_records_governed_source', 'external_records_fields_declared', 'external_evidence_bindings_governed', 'outcome_verifications_external_evidence_governed', 'review_outcome_judgments_external_evidence_governed',
  'external_source_contracts_catalogued', 'external_records_conform_to_contract', 'external_records_fields_conform', 'external_record_conflicts_contest_verifications', 'outcome_verification_validity_forward', 'outcome_verifications_replacement_governed',
];
// The one usable-evidence predicate: an outcome-lane record of an ACTIVE source, unconflicted, bound to THIS Work Item.
const C7A_USABLE_REASONS = ['NOT_OUTCOME_EVIDENCE', 'SOURCE_NOT_ACTIVE', 'RECORD_CONFLICTED', 'NOT_BOUND_TO_WORK_ITEM'];
// No raw payload bag, no stored user reference, no secret in a C7-A table.
const C7A_FORBIDDEN_COLUMN = /^\s*"?(\w*(?:raw|payload|body|content|text|message|transcript|prompt|pseudonym|user_ref|user_id|credential|secret|token)\w*)"?\s+(?:TEXT|BLOB|ANY|INTEGER|REAL)\b/im;
// C7-A extends C6; it never creates a parallel evaluation / learning / performance / report store, and never writes a verdict.
const C7A_PARALLEL_TABLE = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?((?:external|c7)\w*(?:evaluat|lesson|learning|attribution|performance|profile|score|report|verdict)\w*)/i;
const C7A_VERDICT_WRITE = /\b(?:UPDATE|INSERT\s+(?:OR\s+\w+\s+)?INTO)\s+(?:evaluation_results|causal_attributions|learning_\w+|lessons|report_snapshots|work_items|outcome_verifications)\b|\b(?:applyTransition|txTransition|txRecordOutcome)\s*\(/;
// Later / parallel C7 scope never leaks: a separate Pilot objective engine (C7-C binds the canonical Goals instead),
// publishing, website / social connectors and campaign management (C7-D) appear nowhere; the App control families (C7-B)
// appear only in the C7-B modules.
const C7_LATER_SCOPE = /publish[_-]?(?:post|content|social)|social[_-]?connector|website[_-]?edit|cms[_-]?(?:page|edit|publish)|campaign[_-]?(?:plan|management|budget)|paid[_-]?ads|pilot[_-]?objective/i;
// --- C7-B boundaries (Governed App Operations Control Plane) ------------------------------------------------------
const C7B_REPORT = 'docs/C7B_IMPLEMENTATION_REPORT.md';
const C7B_CLOSURE = /^docs\/C7B_[^/]*CLOSURE[^/]*\.md$/i;
const C7B_PROOF_MARKERS = ['C7B-PROOF: control-kernel', 'C7B-PROOF: storage-control-plane'];
const C7B_MUTATION_CHECK = 'scripts/c7b-mutation-check.mjs';
const C7B_KERNEL = 'packages/governance/src/app-controls.ts';
const C7B_STORE = 'packages/storage/src/app-controls.ts';
const C7B_MIGRATION = `${MIGRATIONS_DIR}0013_c7b_governed_app_controls.sql`;
// The control families' own vocabulary lives only in the C7-B kernel, store and migration (never a second control path).
const C7B_FILES = [C7B_KERNEL, C7B_STORE, C7B_MIGRATION];
const C7B_SCOPE = /feature[_-]?flag|kill[_-]?switch|maintenance[_-]?mode|remote[_-]?config|rollout[_-]?control|min(?:imum)?[_-]?supported[_-]?version|route[_-]?hold/i;
// Exactly the seven Product-approved control families (APP-OPS-01 §11, PO-OPS-07), in their canonical order.
const C7B_FAMILIES = ['FEATURE_FLAG', 'KILL_SWITCH', 'MAINTENANCE_MODE', 'ROLLOUT_CONTROL', 'MINIMUM_SUPPORTED_VERSION', 'APPROVED_REMOTE_CONFIGURATION', 'ROUTE_HOLD'];
// The datastore gates every C7-B table carries (code checks are re-checked by triggers).
const C7B_GOVERNED_TRIGGERS = [
  'app_control_families_closed_i', 'app_control_families_closed_u', 'app_control_families_closed_d', 'app_remote_config_families_release_only',
  'app_control_proposals_governed', 'app_control_proposals_forward', 'app_control_revisions_sequence', 'app_control_revisions_r3_governed', 'app_control_revisions_authority_current', 'app_control_revisions_conform',
  'app_control_revisions_append_only_u', 'app_control_revisions_append_only_d', 'external_intake_refusal_windows_bounded_key',
];
// Company state is what the Company ISSUED: no applied / acknowledged / delivered / effective-in-App claim anywhere in C7-B.
const C7B_EFFECT_CLAIM = /\b(?:APPLIED|ACKNOWLEDGED|DELIVERED|EFFECTIVE_IN_APP|LIVE_IN_APP|ACTIVE_IN_APP|APPLIED_IN_APP)\b/;
// No generic execution: no evaluation, process, network or dynamic import in a C7-B module.
const C7B_EXECUTION = /\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\(|(?:from\s+|require\s*\(\s*)['"](?:node:)?(?:child_process|vm|worker_threads|http|https|http2|net|tls|dgram|dns)['"]|\bfetch\s*\(/;
// --- C7-C boundaries (Pilot Instrumentation Pack) ------------------------------------------------------------------
const C7C_REPORT = 'docs/C7C_IMPLEMENTATION_REPORT.md';
const C7C_CLOSURE = /^docs\/C7C_[^/]*CLOSURE[^/]*\.md$/i;
const C7C_PROOF_MARKERS = ['C7C-PROOF: pilot-kernel', 'C7C-PROOF: pilot-evidence-kernel', 'C7C-PROOF: storage-pilots', 'C7C-PROOF: runtime-c7c'];
const C7C_MUTATION_CHECK = 'scripts/c7c-mutation-check.mjs';
const C7C_KERNEL = 'packages/governance/src/pilot.ts';
const C7C_EVIDENCE = 'packages/mind/src/pilot-evidence.ts';
const C7C_STORE = 'packages/storage/src/pilots.ts';
const C7C_MIGRATION = `${MIGRATIONS_DIR}0014_c7c_pilot_instrumentation.sql`;
const C7C_FILES = [C7C_KERNEL, C7C_EVIDENCE, C7C_STORE, C7C_MIGRATION];
// The datastore gates that hold the Pilot lifecycle without TypeScript.
const C7C_GOVERNED_TRIGGERS = [
  'pilots_no_delete', 'pilots_born_draft', 'pilots_identity_immutable', 'pilots_forward', 'pilots_briefing_thread_governed', 'pilots_ready_requires_briefing',
  'pilots_active_requires_root_goal', 'pilots_root_goal_bound_at_activation', 'pilot_history_matches', 'pilot_history_append_only_u', 'pilot_history_append_only_d',
];
// A Pilot is identity + history only: the release creates no other table (no second evaluator, ledger, review or
// learning store — everything else is derived from the canonical tables).
const C7C_TABLES = ['pilots', 'pilot_history', 'founder_action_previews'];
// C7-D (Digital Presence Creation & Operations) never leaks into C7-C: no website, publishing, social, SEO, hosting,
// domain or campaign capability in a C7-C module.
const C7D_SCOPE = /\b(?:website|landing[_-]?page|seo|social[_-]?(?:post|media|channel)|publish\w*|dns|domain[_-]?name|hosting|cms|campaign\w*|ad[_-]?account)\b/i;
// --- C7-D boundaries (Digital Presence Creation & Operations) -----------------------------------------------------
const C7D_REPORT = 'docs/C7D_IMPLEMENTATION_REPORT.md';
const C7D_CLOSURE = /^docs\/C7D_[^/]*CLOSURE[^/]*\.md$/i;
const C7D_PROOF_MARKERS = ['C7D-PROOF: digital-kernel', 'C7D-PROOF: seo-readiness', 'C7D-PROOF: storage-digital', 'C7D-PROOF: github-adapter', 'C7D-PROOF: provider-seams', 'C7D-PROOF: preview-isolation', 'C7D-PROOF: runtime-c7d'];
const C7D_MUTATION_CHECK = 'scripts/c7d-mutation-check.mjs';
const C7D_KERNEL = 'packages/governance/src/digital.ts';
const C7D_SEO = 'packages/mind/src/seo.ts';
const C7D_STORE = 'packages/storage/src/digital.ts';
const C7D_MIGRATION = `${MIGRATIONS_DIR}0015_c7d_digital_presence.sql`;
const C7D_PREVIEW = 'packages/command-center/src/server/preview-listener.ts';
const C7D_DRIVERS = 'packages/tool-drivers/src/';
const C7D_TRANSPORT = 'packages/tool-drivers/src/github/https-transport.ts';
const C7D_GITHUB_DECLARATION = 'packages/tool-drivers/src/github/declaration.ts';
const C7D_GITHUB_ENDPOINTS = 'packages/tool-drivers/src/github/endpoints.ts';
const C7D_FILES = [C7D_KERNEL, C7D_SEO, C7D_STORE, C7D_MIGRATION, C7D_PREVIEW];
// The datastore gates that hold the workshop without TypeScript (immutability, exact bindings, the closed catalogue).
const C7D_GOVERNED_TRIGGERS = [
  'digital_projects_born_draft', 'digital_projects_identity_immutable', 'digital_projects_forward_only', 'digital_projects_no_delete',
  'digital_revisions_born_working', 'digital_revisions_frozen', 'digital_revisions_finalize_matches_files', 'digital_revisions_no_delete',
  'digital_revision_files_working_only_i', 'digital_revision_files_working_only_u', 'digital_revision_files_no_delete',
  'digital_uploads_born_open', 'digital_uploads_settle_once', 'digital_upload_chunks_open_only', 'digital_upload_chunks_immutable_u', 'digital_upload_chunks_immutable_d',
  'digital_previews_exact_revision', 'digital_previews_immutable_u', 'digital_previews_immutable_d',
  'digital_release_candidates_exact_revision', 'digital_release_candidates_immutable_u', 'digital_release_candidates_immutable_d',
  'digital_promotion_targets_identity_immutable', 'digital_promotion_targets_no_delete',
  'digital_promotions_exact_binding', 'digital_promotions_immutable_u', 'digital_promotions_immutable_d',
  'tools_digital_workspace_reserved', 'tool_actions_digital_workspace_closed', 'tools_digital_workspace_internal',
];
// The workshop is identity and binding only: no second review, approval, evaluation, cost, schedule or Pilot table.
const C7D_TABLES = ['digital_projects', 'digital_project_history', 'digital_revisions', 'digital_revision_files', 'digital_uploads', 'digital_upload_chunks', 'digital_previews', 'digital_release_candidates', 'digital_promotion_targets', 'digital_promotions'];
// File content stays in the Artifact Store: no content / blob / payload column, and no secret, token, cookie or score.
const C7D_FORBIDDEN_COLUMN = /^\s*"?(\w*(?:content|body|blob|payload|html|markup|base64|secret|token|password|cookie|private_?key|score|rank|rating)\w*)"?\s+(?:TEXT|BLOB|ANY|INTEGER|REAL)\b/im;
// C7-D builds capability: no website framework, hosting, CMS, analytics, SEO vendor or social platform is chosen in code.
const C7D_VENDOR = /\b(?:vercel|netlify|cloudflare|wordpress|webflow|wix|squarespace|shopify|contentful|sanity\.io|next\.?js|nuxt|gatsby|astro\.build|google[_ -]?analytics|plausible|mixpanel|semrush|ahrefs|instagram|facebook|tiktok|linkedin|twitter|youtube|snapchat)\b/i;
// Publication is never market success; nothing in C7-D may say otherwise.
const C7D_SUCCESS_CLAIM = /\b(?:publicationIsMarketSuccess|countsAsMarketOutcome|countsAsOutcome|marketSuccess)\s*:\s*true\b/;
// --- L1-01 boundaries (DeepSeek V4.1 Flash live provider, the Windows secure vault, truthful pricing) -------------------
const L1_REPORT = 'docs/L1_01_IMPLEMENTATION_REPORT.md';
const L1_CLOSURE = /^docs\/L1_01_[^/]*CLOSURE[^/]*\.md$/i;
const L1_PROOF_MARKERS = ['L1-PROOF: secret-vault', 'L1-PROOF: deepseek-adapter', 'L1-PROOF: economics-bands', 'L1-PROOF: storage-pricing', 'L1-PROOF: runtime-l1'];
const L1_MUTATION_CHECK = 'scripts/l1-mutation-check.mjs';
// L1-02: the first production Company activation (docs/L1_02_IMPLEMENTATION_REPORT.md, D-L1-12 … D-L1-16).
const L1_02_REPORT = 'docs/L1_02_IMPLEMENTATION_REPORT.md';
const L1_02_CLOSURE = /^docs\/L1_02_[^/]*CLOSURE[^/]*\.md$/i;
const L1_02_ACTIVATION = 'packages/storage/src/founder-activation.ts';
const L1_02_PACKAGES = 'packages/storage/src/academy-packages.ts';
const L1_02_FILES = [L1_02_ACTIVATION, L1_02_PACKAGES, 'packages/storage/src/answers.ts', 'packages/storage/src/activation-view.ts'];
const L1_02_PROOF_MARKERS = ['L1-02-PROOF: activation-runtime', 'L1-02-PROOF: activation-surface', 'L1-02-PROOF: academy-answer', 'L1-02-PROOF: package-revision', 'L1-02-PROOF: answer-semantics', 'L1-02-PROOF: score-finalization', 'L1-02-PROOF: package-v3', 'L1-02-PROOF: bqm2', 'L1-02-PROOF: bqm2-store', 'L1-02-PROOF: bqm2-preview', 'L1-02-PROOF: answer-only', 'L1-02-PROOF: package-v4', 'L1-02-PROOF: skill-reuse', 'L1-02-PROOF: skill-reuse-store', 'L1-02-PROOF: package-v5', 'L1-02-PROOF: package-v5-store', 'L1-02-PROOF: package-v6', 'L1-02-PROOF: package-v6-store', 'L1-02-PROOF: package-v7', 'L1-02-PROOF: package-v7-store'];
const L1_02_BENCH_LOADER = /\bloadBenchmarkSkillInstructions\b/;
const L1_02_BENCH_LOADER_FILES = ['packages/storage/src/mind-core.ts', 'packages/storage/src/mind-writes.ts'];
const L1_VAULT_SRC = 'packages/secret-vault/src/';
const L1_VAULT = 'packages/secret-vault/src/windows-dpapi.ts';
const L1_VAULT_CLI = 'packages/secret-vault/src/cli.ts';
const L1_PROVIDERS_SRC = 'packages/model-providers/src/';
const L1_TRANSPORT = 'packages/model-providers/src/deepseek/https-transport.ts';
const L1_ADAPTER = 'packages/model-providers/src/deepseek/adapter.ts';
const L1_DECLARATION = 'packages/model-providers/src/deepseek/declaration.ts';
const L1_PRICING = 'packages/model-providers/src/deepseek/pricing.ts';
const L1_MIGRATION = `${MIGRATIONS_DIR}0016_l1_provider_pricing_identity.sql`;
const L1_FILES = [L1_VAULT, L1_ADAPTER, L1_TRANSPORT, L1_MIGRATION];
// --- OPS boundaries (Operational / Desktop Packaging: the Founder host lifecycle, D-OPS-01 … D-OPS-06) ---------------
// The launcher's loopback-only identity / stop client and the one module that starts processes (host, browser, PowerShell).
const OPS_HOST_PROBE = 'packages/command-center/src/host/probe.ts';
const OPS_HOST_PROCESSES = 'packages/command-center/src/host/processes.ts';
const OPS_HOST_DESCRIPTOR = 'packages/command-center/src/host/descriptor.ts';
// D-OPS-07: the one-shot loopback launch handoff (the browser never receives the launch credential as an argument).
const OPS_HOST_HANDOFF = 'packages/command-center/src/host/handoff.ts';
const OPS_HOST_LIFECYCLE = 'packages/command-center/src/host/lifecycle.ts';
// D-D2-01: the stopped-state desktop controller (the Command Center window's own Stop / Start / Restart while stopped).
const OPS_DESKTOP_CONTROL = 'packages/command-center/src/host/desktop-control.ts';
const OPS_SECURITY = 'packages/command-center/src/security.ts';
// D-OPS-08: the production runtime release — admission in the runtime, staging / activation in the surface package.
const OPS_RELEASE_ADMISSION = 'packages/runtime/src/release.ts';
const OPS_RUNTIME = 'packages/runtime/src/runtime.ts';
const OPS_RELEASE = 'packages/command-center/src/host/release.ts';
const OPS_CLI = 'packages/command-center/src/cli.ts';
const OPS_HOST_FILES = [OPS_HOST_PROBE, OPS_HOST_PROCESSES, OPS_HOST_DESCRIPTOR, OPS_HOST_HANDOFF, OPS_RELEASE, OPS_DESKTOP_CONTROL];
const OPS_PROOF_MARKERS = ['OPS-PROOF: founder-host-descriptor', 'OPS-PROOF: founder-host-lifecycle', 'OPS-PROOF: founder-launch-handoff', 'OPS-PROOF: founder-host-release', 'OPS-PROOF: desktop-lifecycle-control', 'OPS-PROOF: desktop-control-boundary'];
const L1_GOVERNED_TRIGGERS = ['price_card_schedules_immutable_u', 'price_card_schedules_immutable_d', 'price_card_schedules_never_above_peak', 'usage_records_cached_within_input', 'model_identity_checks_append_only_u', 'model_identity_checks_append_only_d'];
/** The provider's chain-of-thought field: never read, returned, logged or persisted (comments may name it). */
const L1_THINKING_FIELD = /\breasoning_content\b/;
/** A thinking-mode effort table: E1 none, E2 low, E3 high, E4 max (the Founder-approved pilot mapping). */
const L1_THINKING_TABLE = /DEEPSEEK_THINKING_BY_CLASS[^=]*=\s*Object\.freeze\(\{\s*E1:\s*'none',\s*E2:\s*'low',\s*E3:\s*'high',\s*E4:\s*'max'\s*\}\)/;
/** The top-level `reasoning_effort` request field is allowlisted (the official thinking-mode wire shape). */
const L1_EFFORT_ALLOWLISTED = /DEEPSEEK_REQUEST_FIELDS\s*=\s*\[[^\]]*'reasoning_effort'/;
/** The effort nested inside the `thinking` object: the wrong contract (ignored by the provider). */
const L1_EFFORT_NESTED = /thinking:\s*\{[^}]*reasoning_effort/;
const C7D_CLAIMED_BUILT = /QANDEEL\s+website\s+(?:is|was|has\s+been)\s+(?:built|launched|published|live|deployed)|(?:selected|chose|chosen|picked)\s+(?:vercel|netlify|cloudflare|wordpress|webflow|next\.?js|instagram|linkedin|google\s+analytics)\b/i;
// No private App content, secret or score column on a Pilot table.
const C7C_FORBIDDEN_COLUMN = /^\s*"?(\w*(?:transcript|audio|prompt|conversation|memory|analysis|user_?(?:id|ref)|pseudonym|secret|token|credential|password|score|rank|rating|grade)\w*)"?\s+(?:TEXT|BLOB|ANY|INTEGER|REAL)\b/im;
// The production Founder session scope is entered only by the auth module (a session, never a ref, arms it).
const FOUNDER_AUTH = 'packages/storage/src/founder-auth.ts';
// Rule A for C5: message bodies, briefs, goal text and command text never enter audit, events or logs.
const C5_WRITERS = ['founder-auth', 'goals', 'communications', 'attention', 'founder-actions', 'universe'].map((m) => `packages/storage/src/${m}.ts`);
const C5_CONTENT_IN_TELEMETRY = /\b(?:appendAudit|appendEvent|\.(?:info|warn|error|debug)|this\.#log|log)\s*\([^\n]*[{,]\s*(?:body|brief|title|summary|text|instructions|happening|matters|recommendation|decision|successCriteria|objective)\s*[,:}]/;
const C2_PROOF_MARKERS = ['C2-PROOF: governance-kernel', 'C2-PROOF: storage-governance', 'C2-PROOF: concurrent-reservations', 'C2-PROOF: governed-runtime', 'C2-PROOF: governed-crash-recovery'];
const C2_MUTATION_CHECK = 'scripts/c2-mutation-check.mjs';

// --- C3 boundaries ------------------------------------------------------------------------------
const C3_CLOSURE = /^docs\/C3_[^/]*CLOSURE[^/]*\.md$/i;
const C3_REPORT = 'docs/C3_IMPLEMENTATION_REPORT.md';
const C3_PROOF_MARKERS = ['C3-PROOF: mind-kernel', 'C3-PROOF: storage-mind', 'C3-PROOF: runtime-mind', 'C3-PROOF: memory-crash-recovery', 'C3-PROOF: concurrent-certification', 'C3-PROOF: review-fixes', 'C3-PROOF: founder-decisions'];
const C3_MUTATION_CHECK = 'scripts/c3-mutation-check.mjs';

// --- C4 boundaries ------------------------------------------------------------------------------
const C4_CLOSURE = /^docs\/C4_[^/]*CLOSURE[^/]*\.md$/i;
const C4_REPORT = 'docs/C4_IMPLEMENTATION_REPORT.md';
const C4_PROOF_MARKERS = ['C4-PROOF: c4-kernel', 'C4-PROOF: storage-organization', 'C4-PROOF: storage-review', 'C4-PROOF: runtime-c4', 'C4-PROOF: concurrent-organization'];
const C4_MUTATION_CHECK = 'scripts/c4-mutation-check.mjs';
// Durable organization / delegation / review state changes only in the C4 storage modules.
const ORG_WRITERS = ['org-core', 'organization', 'org-writes', 'review-core', 'review'].map((m) => `packages/storage/src/${m}.ts`);
const ORG_WRITE = /\b(?:UPDATE|INSERT\s+(?:OR\s+\w+\s+)?INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+(?:org_positions|org_position_history|department_charters|position_assignment\w*|staffing_request\w*|authority_delegations|work_delegation\w*|handoff_messages|org_act_records|run_org_snapshots|review_(?:plans|requests|request_history|assignments|decisions|conflicts|calibrations)|reviewer_qualification\w*|quality_holds|oversight_findings)\b/i;
// Founder organization / review acts: model output never reaches them (runtime code and the CLI never call them).
const ORG_FOUNDER_CALL = /\.(?:assignPrimary|assignActing|endAssignment|createPosition|setPositionStatus|delegateAuthority|revokeDelegation|decideStaffingRequest|publishCharter|resumeEscalatedHandoff|admitReviewer|promoteReviewer|reinstateReviewer|suspendReviewer|revokeReviewer|calibrateShadowDecision|decideFounderKey|resolveConflict|resolveEscalation|placeQualityHold|liftQualityHold|requestOversight|advanceFinding|declarePlan)\s*\(/;
// Rule A for C4: staffing evidence, handoff messages, review rationale and reviewer instructions never enter telemetry.
const C4_CONTENT_IN_TELEMETRY = /\b(?:appendAudit|appendEvent|\.(?:info|warn|error|debug))\s*\([^\n]*[{,]\s*(?:rationale|body|answer|reason|note|objective|instructions|reviewerInstructions|businessNeed|workloadEvidence|skillGap|expectedValue|impactIfNotStaffed|alternatives|content|text)\s*[,:}]/;
// The canonical Strong-v1 Department map (D-R1-05): Engineering is the permanent fifth Department.
const CANONICAL_DEPARTMENTS = ['strategic-market-intelligence', 'growth', 'brand-creative', 'product', 'engineering'];
const R4_REVIEW_CHECK = /CHECK\s*\(\s*risk_level\s*<>\s*'R4'\s+OR\s+state\s+NOT\s+IN\s*\(\s*'SATISFIED'\s*,\s*'CONSUMED'\s*\)\s*\)/;
const AUTHORITY_KERNEL = 'packages/governance/src/authority.ts';
// --- CI contract (D-R1-07 / D-C4-08 / D-D0-01) ----------------------------------------------------
const CI_WORKFLOW = '.github/workflows/ci.yml';
const CI_CLASSIFIER = 'scripts/ci/classify-changes.mjs';
const CI_GATE = 'scripts/ci/quality-gate.mjs';
const CI_POST_MERGE = 'scripts/ci/post-merge-mode.mjs';
const CI_IMPACT_MAP = 'scripts/ci/impact-map.mjs';
const CI_LOCAL_RUNNER = 'scripts/ci/validate-affected.mjs';
// D1 (D-D1-07): the reusable Windows Desktop proof workflow (the FULL path's `desktop` job).
const CI_DESKTOP_WORKFLOW = '.github/workflows/desktop.yml';
const CI_JOBS = ['classify', 'docs-fast', 'integrity', 'affected-checks', 'affected-mutation', 'static', 'tests', 'mutation', 'acceptance', 'desktop', 'quality-gate'];
// --- D1 Desktop v1 distribution (D-D1-01 … D-D1-07) ------------------------------------------------
const DESKTOP_ISS = 'packaging/windows/qandeel-company.iss';
const DESKTOP_PINS = 'packaging/windows/desktop.pins.json';
const DESKTOP_ICON_PROVENANCE = 'packaging/windows/assets/ICON_PROVENANCE.json';
const DESKTOP_MODULE = 'packages/command-center/src/host/desktop.ts';
const DESKTOP_PROOFS = ['packaging/windows/proof/desktop-proof.mjs', 'packaging/windows/proof/desktop-e2e.mjs'];
/** The frozen I-08B2.4 Variant B app icon carried by the ratified I-08B2.5 brand authority (the only approved source). */
const DESKTOP_ICON_SOURCE_SHA256 = '859665d86a7bbf4248ff479034031a8df1f08833c7db36336b3d29832bcddd09';
const CI_BOTH_OS_JOBS = ['static', 'tests', 'acceptance', 'integrity'];
const CI_OPERATING_SYSTEMS = ['windows-latest', 'ubuntu-latest'];
/** The body of one top-level job of a workflow (two-space job keys under `jobs:`). */
const ciJob = (wf, id) => {
  const jobs = wf.slice(wf.search(/^jobs:\s*$/m));
  const start = jobs.search(new RegExp(`^ {2}${id.replace(/[-]/g, '\\-')}:\\s*$`, 'm'));
  if (start < 0) return undefined;
  const rest = jobs.slice(start + 1);
  const next = rest.search(/^ {2}[\w-]+:\s*$/m);
  return next < 0 ? jobs.slice(start) : jobs.slice(start, start + 1 + next);
};
// D-D0-01: a mutation family is wired into the continuity proof when the FULL CI mutation matrix runs it on BOTH
// operating systems. Returns e.g. "c1:mutation c2:mutation …" (the families every OS runs).
const fullMutationSuites = (read) => {
  const job = ciJob(read(CI_WORKFLOW) ?? '', 'mutation') ?? '';
  const per = Object.fromEntries(CI_OPERATING_SYSTEMS.map((os) => [os, new Set()]));
  for (const m of job.matchAll(/os:\s*([\w-]+),[^}]*suite:\s*'([^']+)'/g)) for (const spec of m[2].split(/\s+/)) per[m[1]]?.add(spec.split(':')[0]);
  return [...per[CI_OPERATING_SYSTEMS[0]]].filter((x) => CI_OPERATING_SYSTEMS.every((os) => per[os].has(x))).map((x) => `${x}:mutation`).join(' ');
};
/**
 * A workflow that does not parse runs NOTHING: GitHub cannot read `on:`, records a failed zero-job run for
 * any push and never creates the pull_request gate (C4 run 36484710639). Its commonest cause is a plain
 * (unquoted) value containing ': ', which YAML reads as a nested mapping. Block scalars (`|`, `>`) and
 * trailing comments are exempt; quoted values and flow collections are not plain.
 */
const yamlPlainScalarErrors = (text) => {
  const problems = [];
  let blockIndent = -1;
  text.split('\n').forEach((line, i) => {
    const indent = line.search(/\S/);
    if (blockIndent >= 0) {
      if (indent === -1 || indent > blockIndent) return;
      blockIndent = -1;
    }
    const m = /^\s*(?:-\s+)?[A-Za-z_][\w-]*:\s+(.*)$/.exec(line);
    if (!m) return;
    const value = m[1].replace(/\s+#.*$/, '').trimEnd();
    if (/^[|>]/.test(value)) blockIndent = indent;
    else if (value !== '' && !/^["'[{&*!#]/.test(value) && (/:\s/.test(value) || value.endsWith(':'))) problems.push(`${CI_WORKFLOW}:${i + 1}: a plain value contains ': ' (YAML reads a nested mapping; the workflow would not parse) — quote it or reword it`);
  });
  return problems;
};
// R1-15: the mutation checks are pinned. Every recorded mutation must stay in its script (a script may
// only grow), the script must keep the machinery that makes a mutation meaningful (the exact-count
// guard, the run of the proof tests, the restore, the failing exit) and the FULL CI mutation matrix must run it on both
// operating systems (D-D0-01: the root "ci" script is the proportional local entrypoint and never runs mutations).
const R1_MUTATION_CHECK = 'scripts/r1-mutation-check.mjs';
const MUTATION_PINS = {
  [MUTATION_CHECK]: { script: 'c1:mutation', ids: ['claim-without-supervisor-verification', 'recovery-without-supervisor-verification', 'heartbeat-without-wake-reconciliation', 'backup-finalization-without-retry', 'backup-failure-leaves-attempt', 'backup-record-not-idempotent'] },
  [C2_MUTATION_CHECK]: {
    script: 'c2:mutation',
    ids: ['authority-no-default-deny', 'authority-r4-not-founder-only', 'authority-r3-without-founder-approval', 'governance-admin-not-founder-only', 'approval-self-decision-allowed', 'reservation-without-headroom-check', 'ineligible-employee-can-run', 'denied-tool-reaches-driver', 'idempotent-replay-removed', 'call-despite-refused-reservation', 'd4-external-egress-allowed', 'silent-expensive-fallback', 'processor-can-widen-egress', 'tool-result-does-not-raise-class', 'escalation-on-self-reported-uncertainty', 'founder-ref-is-authentication', 'activation-without-certification', 'd3-external-egress-allowed', 'd3-external-reservation-allowed', 'budget-floor-counts-finished-children', 'budget-floor-ignores-running-run'],
  },
  [C3_MUTATION_CHECK]: {
    script: 'c3:mutation',
    ids: [
      'memory-secret-stored', 'memory-contradicts-canonical', 'memory-model-sets-confidence', 'context-budget-soft', 'critical-dimension-compensated', 'skill-license-unclear-eligible', 'skill-paid-dependency-silent', 'skill-executable-content-passes',
      'reservation-without-manifest', 'knowledge-scope-leak', 'memory-other-employee-visible', 'corrupt-content-used', 'unpinned-skill-loads', 'capability-gate-bypassed', 'academy-authority-unconstrained', 'holdout-reused', 'evaluator-sets-run-facts',
      'conflict-resolution-no-wake', 'capability-wait-not-rechecked', 'processor-supplied-recent-results', 'canonical-binds-only-if-relevant', 'probation-fail-no-new-epoch', 'rubric-ignores-refused-actions', 'licence-review-skipped', 'model-accepts-foreign-context',
      'pending-candidates-not-recovered', 'context-hold-not-rechecked', 'term-limit-before-filter', 'compaction-crosses-markets', 'failed-attempt-hides-breach', 'role-cert-loss-ignored', 'role-cert-loss-not-at-run-start', 'role-cert-loss-not-at-authorization',
      'role-cert-loss-not-at-reservation', 'role-cert-loss-not-at-tool-intent', 'role-reassignment-without-cert-keeps-active', 'calibration-not-required-at-activation', 'calibration-gates-certification', 'extension-evidence-not-required', 'unlicense-auto-clears',
      // R2 (K7): memory promotion conflicts, Academy simulation retest, skill-update rollout set.
      'r2-personal-promotion-skips-conflict', 'r2-simulation-gate-counts-retrained-failure', 'r2-retry-strands-started-retest', 'r2-practice-consumes-assessment-retest', 'r2-rollout-uses-plan-snapshot', 'r2-rollback-misses-rolled-out-passports',
    ],
  },
  [C4_MUTATION_CHECK]: {
    script: 'c4:mutation',
    ids: [
      'c4-org-act-grant-bypassed', 'c4-org-seat-eligibility-removed', 'c4-delegation-limits-ignored', 'c4-delegation-cycle-allowed', 'c4-delegation-outside-reporting-line', 'c4-self-review-allowed',
      'c4-quality-hold-ignored-in-selection', 'c4-decision-not-rechecked', 'c4-stale-subject-decision-counts', 'c4-action-review-gate-removed', 'c4-action-review-reusable', 'c4-rejected-action-rereviewed',
      'c4-review-wait-not-rechecked', 'c4-delegation-wait-free-wake', 'c4-open-handoff-completes', 'c4-p07-reservation-unchecked', 'c4-p07-router-unfiltered', 'c4-p07-release-covers-future',
      'c4-acting-never-expires', 'c4-acting-authority-outlives-cover', 'c4-ceo-needs-department', 'c4-calibration-counted-twice', 'c4-promotion-without-evidence', 'c4-org-managed-reassignable', 'c4-staffing-alternatives-optional',
      // R2 K1: review integrity and Review Pool eligibility.
      'c4r2-executor-redesigns-own-plan', 'c4r2-rework-scoped-by-plan', 'c4r2-stranded-action-wait-not-woken', 'c4r2-manager-key-department-bound', 'c4r2-manager-key-filled-last', 'c4r2-withdrawn-reviewer-excluded-forever',
      'c4r2-rubric-hold-not-rechecked', 'c4r2-action-subject-truncated', 'c4r2-oversized-subject-admitted', 'c4r2-secret-arguments-reach-reviewer', 'c4r2-dead-letter-keeps-review-key',
      // R2 K2: one open-handoff set; a delegator answers its own delegate's question.
      'c4-open-handoff-set-narrowed', 'c4-delegator-waits-on-own-clarification', 'c4-restart-answers-clarification',
      // RR2-2 / RR2-5 (second-wave cluster Q1): a refused FINAL is told; a handoff never outlives its delegator.
      'rr2-2-final-refusal-silent', 'rr2-2-failed-delegator-keeps-children', 'rr2-5-rework-under-ended-lineage',
    ],
  },
  [C5_MUTATION_CHECK]: {
    script: 'c5:mutation',
    ids: [
      'c5-founder-ref-is-authentication', 'c5-session-expiry-ignored', 'c5-session-scope-stays-armed', 'c5-csrf-gate-removed', 'c5-host-gate-removed', 'c5-text-mutates-without-confirmation', 'c5-preview-fingerprint-unchecked',
      'c5-rank-order-flattened', 'c5-department-column-collapsed', 'c5-goal-work-link-dropped', 'c5-attention-widened-to-routine', 'c5-message-grants-authority', 'c5-message-body-in-audit', 'c5-history-uses-current-truth', 'c5-r4-offered-as-approvable', 'c5-company-goal-without-founder', 'c5-founder-reads-announce-change', 'c5-zero-delta-attention-sync-announces',
      // R2 remediation (cluster K5): confirm atomicity, the exception loop, attention identity, intent resolution.
      'c5-confirm-effect-commits-alone', 'c5-exception-decision-overtakes-tool', 'c5-attention-misses-uncertain-effects', 'c5-dismissal-swallows-source-changes', 'c5-resilience-keyed-per-class', 'c5-goal-state-verb-lost', 'c5-unmatched-argument-falls-back',
      // R2 second wave (cluster Q4): the command's own verb decides the intent (RR1-1).
      'c5-argument-verb-selects-intent', 'c5-argument-noun-selects-act',
      // R2 Architecture Closure Correction AC-01 (PO-R2-D): a goal act needs the Director seat AND its own grant.
      'c5-goal-derive-grant-skipped', 'c5-goal-link-grant-skipped', 'c5-goal-link-seat-skipped', 'c5-goal-derive-seat-skipped', 'c5-goal-grant-use-not-consumed',
    ],
  },
  [C6_MUTATION_CHECK]: {
    script: 'c6:mutation',
    ids: [
      'c6-completion-counts-as-success', 'c6-activity-boosts-performance', 'c6-insufficient-evidence-judged', 'c6-system-cause-blamed-on-employee', 'c6-tool-failure-unmapped', 'c6-config-cause-blamed-on-provider', 'c6-non-employee-negative-counted', 'c6-evaluator-cannot-return-unknown',
      'c6-reflection-bypasses-validation', 'c6-lesson-validation-skips-gate', 'c6-pattern-auto-shared', 'c6-holdout-leaks-to-trainee', 'c6-training-equals-improvement', 'c6-retraining-loops-forever', 'c6-systemic-credit-misattributed', 'c6-systemic-credit-before-validation', 'c6-recommendation-mutates-authority',
      'c6-universal-score-reintroduced', 'c6-cost-rewards-cheap-failure', 'c6-backup-encryption-bypassed', 'c6-backup-checksum-ignored', 'c6-retention-keeps-only-latest', 'c6-update-activates-before-verification', 'c6-update-hold-ignored',
      'c6-restore-releases-uncertain-effect', 'c6-report-judgement-without-evidence', 'c6-outcome-verified-before-review', 'c6-external-outcome-invented',
      // R2 (cluster K4): evidence identity, work time, pending causes, recovered failures, economic cost.
      'c6-recovered-failure-is-the-cause', 'c6-work-item-counted-per-definition', 'c6-pre-training-work-counts-as-later', 'c6-pending-recurrence-ignored', 'c6-pattern-reuse-evidence-reused', 'c6-self-reuse-credited',
      'c6-pending-adverse-reads-clean', 'c6-disputed-cause-dead-end', 'c6-decided-finding-silences-recurrence', 'c6-retraining-exhaustion-swallowed', 'c6-billed-cost-as-economic', 'c6-zero-cost-efficient',
      // R2 second wave (cluster Q3): one meaning of adverse evidence in every attribution state (RR3).
      'c6-rejected-cause-pending-forever', 'c6-rejected-cause-reads-clean', 'c6-rejected-attribution-unread', 'c6-corrected-causes-dropped', 'c6-non-adverse-negative-pending', 'c6-post-training-recurrence-excluded',
      // R2 Architecture Closure Correction FB-1: learning is timed by the source evidence event.
      'fb1-pre-training-event-counted', 'fb1-review-timed-by-decision', 'fb1-source-event-multiplied', 'fb1-unplaceable-event-final', 'rb2-pending-proposal-replaced-by-new-evidence',
      // C6-R1: operational judgment through the Review Pool; verification authority is never execution authority.
      'c6r1-ordinary-outcome-founder-only', 'c6r1-r4-judged-by-pool', 'c6r1-founder-key-pool-judgment', 'c6r1-outcome-conflict-averaged', 'c6r1-pass-verifies-without-judgment', 'c6r1-uncertainty-validates',
      'c6r1-self-judgment', 'c6r1-judge-eligibility-not-rechecked', 'c6r1-validated-lesson-shared-company-wide', 'c6r1-judgment-budget-inflated', 'c6r1-judgment-raises-budget',
      'c6-read-announces-change', 'c6-unchanged-derivation-announces',
      // R2 K6 (resilience): R2-28 .. R2-31, m-22.
      'c6-separate-volume-counts-as-off-device', 'c6-restore-dispatches-past-backup-point', 'c6-existing-company-migrated-at-open', 'c6-start-skips-safe-upgrade', 'c6-maintenance-ignores-open-connection', 'c6-rollback-discards-post-update-work', 'c6-restore-hold-left-to-operator',
      // R2 K1: pool judges — one eligibility predicate, gated lesson draws, release on every end path.
      'c6r2-lesson-judge-drawn-before-evidence', 'c6r2-judge-rubric-hold-not-rechecked', 'c6r2-withdrawn-judge-excluded-forever', 'c6r2-judgment-survives-qualification', 'c6r2-ended-judge-keeps-judgment',
      // R2 second wave (cluster Q4): a restore-check target is a permanently held verification copy (RR4-1).
      'c6q4-restore-check-copy-unmarked', 'c6q4-restore-check-hold-clearable', 'c6q4-restore-check-copy-opens',
      // R2 architecture correction FB-2: a live portable restore is fail-closed from its first byte until the controlled restore commits.
      'c6fb2-marker-after-db-copy', 'c6fb2-inspection-opens-partial-restore', 'c6fb2-marker-lifted-before-commit', 'c6fb2-restore-hold-clearable', 'c6fb2-other-package-hijacks-partial-restore', 'c6fb2-bypass-not-bound-to-attempt',
      // R2 second wave (cluster Q2): freed reviewer capacity is a wake (RR1-2).
      'c6rr1-decided-judgment-frees-nothing', 'c6rr1-withdrawn-judgment-frees-nothing', 'c6rr1-withdrawal-redraws-its-subject', 'c6rr1-decided-key-frees-nothing', 'c6rr1-released-key-frees-nothing', 'c6rr1-judgments-before-reviews', 'c6rr1-sweep-skips-waiting-actions',
    ],
  },
  // C7-A Operational Data + External Outcome Core (docs/C7A_IMPLEMENTATION_REPORT.md).
  [C7A_MUTATION_CHECK]: {
    script: 'c7a:mutation',
    ids: [
      'c7a-private-field-not-refused-by-name', 'c7a-free-text-admitted', 'c7a-secret-value-admitted', 'c7a-unknown-field-passes', 'c7a-pseudonym-stored', 'c7a-refused-payload-audited',
      'c7a-inactive-source-ingests', 'c7a-contract-drift-ignored', 'c7a-metric-family-unchecked', 'c7a-future-occurrence-accepted', 'c7a-source-lifecycle-not-forward', 'c7a-source-registry-not-founder', 'c7a-source-activation-not-founder',
      'c7a-conflicting-replay-accepted', 'c7a-replay-not-idempotent', 'c7a-operational-fact-as-outcome-evidence', 'c7a-binding-not-founder',
      'c7a-external-check-skipped-at-verification', 'c7a-operational-record-citable', 'c7a-suspended-source-usable', 'c7a-conflicted-record-usable', 'c7a-unbound-evidence-usable', 'c7a-pool-judgment-unchecked', 'c7a-pool-resolution-not-rechecked',
      'c7a-external-class-not-evidence', 'c7a-dependency-failure-ignored', 'c7a-report-always-unavailable', 'c7a-registry-requires-external-without-source', 'c7a-attention-misses-external-exceptions',
      // D-C7A-11: a late integrity conflict takes the disputed outcome out of current C6 truth until the Founder decides.
      'c7a-contest-not-restated', 'c7a-contested-verdict-trusted', 'c7a-contest-not-a-conflict', 'c7a-report-presents-contested', 'c7a-attention-misses-contest', 'c7a-contest-resolution-not-founder', 'c7a-contested-pattern-counts', 'c7a-contested-pattern-reused', 'c7a-contested-open-reuse-progresses', 'c7a-db-conflict-contests-nothing', 'c7a-db-validity-forgeable',
      // D-C7A-10: the datastore enforces the registered contract, not only TypeScript.
      'c7a-db-contract-not-catalogued', 'c7a-db-type-family-unchecked', 'c7a-db-type-unchecked', 'c7a-db-domain-unchecked', 'c7a-db-unit-unchecked', 'c7a-db-scope-unchecked', 'c7a-db-duplicate-keys-admitted', 'c7a-db-fields-unchecked',
    ],
  },
  // C7-B Governed App Operations Control Plane (docs/C7B_IMPLEMENTATION_REPORT.md).
  [C7B_MUTATION_CHECK]: {
    script: 'c7b:mutation',
    ids: [
      'c7b-eighth-family-admitted', 'c7b-db-family-catalogue-open',
      'c7b-org-act-not-r3', 'c7b-grant-family-scope-ignored', 'c7b-seat-not-required', 'c7b-db-proposal-seat-unchecked', 'c7b-review-settle-unhooked', 'c7b-review-not-required-at-issue', 'c7b-db-review-not-required', 'c7b-approval-unhooked', 'c7b-db-founder-approval-not-required',
      'c7b-fingerprint-ignores-value', 'c7b-db-act-not-bound', 'c7b-stale-expectation-unguarded', 'c7b-concurrent-proposal-not-staled', 'c7b-db-sequence-unguarded', 'c7b-no-change-reissued', 'c7b-db-history-mutable', 'c7b-db-proposal-revivable',
      'c7b-db-family-scope-unchecked', 'c7b-db-scope-identifiers-unchecked', 'c7b-db-value-unchecked', 'c7b-db-route-hold-selects', 'c7b-db-remote-config-ungated', 'c7b-db-register-open', 'c7b-db-applied-state-admitted',
      'c7b-route-hold-not-negative', 'c7b-route-selection-unnamed', 'c7b-remote-config-gate-removed', 'c7b-generic-execution-unnamed',
      'c7b-issue-seat-unchecked', 'c7b-issue-grant-unchecked', 'c7b-db-issue-seat-unchecked', 'c7b-db-issue-grant-revocation-unchecked', 'c7b-db-issue-grant-expiry-unchecked',
      'c7b-stale-hook-unwired', 'c7b-stale-review-not-recovered', 'c7b-stale-approval-not-revoked', 'c7b-db-founder-entry-unguarded',
      'c7b-event-carries-content', 'c7b-refusals-audited-per-row', 'c7b-db-refusal-key-unbounded',
    ],
  },
  // C7-C Pilot Instrumentation Pack (docs/C7C_IMPLEMENTATION_REPORT.md).
  [C7C_MUTATION_CHECK]: {
    script: 'c7c:mutation',
    ids: [
      'c7c-ready-without-briefing', 'c7c-db-ready-without-briefing', 'c7c-briefing-boundary-dropped', 'c7c-db-briefing-boundary-dropped', 'c7c-message-read-as-authority', 'c7c-active-without-root-goal', 'c7c-db-active-without-root-goal',
      'c7c-terminal-pilot-revived', 'c7c-db-terminal-pilot-revived', 'c7c-db-mode-mutable', 'c7c-founder-decision-bypass', 'c7c-repeated-step-not-idempotent',
      'c7c-duplicate-thread-linkage', 'c7c-duplicate-root-goal-linkage',
      'c7c-activity-counted-as-performance', 'c7c-universal-aggregation', 'c7c-attribution-bypass', 'c7c-unauthorized-initiative-counted', 'c7c-boundary-refusal-as-autonomy', 'c7c-review-bypass', 'c7c-training-completion-as-improvement', 'c7c-zero-qualified-efficient', 'c7c-economics-bypass-ledger',
      'c7c-contested-outcome-counted', 'c7c-training-called-market-success', 'c7c-issued-control-as-outcome', 'c7c-audit-leaks-content',
    ],
  },
  // C7-D Digital Presence Creation & Operations (docs/C7D_IMPLEMENTATION_REPORT.md).
  [C7D_MUTATION_CHECK]: {
    script: 'c7d:mutation',
    ids: [
      'c7d-path-traversal-accepted', 'c7d-secret-path-accepted', 'c7d-secret-content-accepted', 'c7d-finalized-revision-mutable', 'c7d-db-finalized-files-mutable', 'c7d-db-revision-unfrozen',
      'c7d-workspace-ownership-dropped', 'c7d-chunk-hash-ignored', 'c7d-db-candidate-mutable', 'c7d-corrupt-artifact-accepted',
      'c7d-export-args-unbound', 'c7d-db-promotion-hash-unbound', 'c7d-db-promotion-not-external', 'c7d-db-target-identity-mutable', 'c7d-refused-promotion-regenerates', 'c7d-publication-as-market-outcome',
      'c7d-review-bypassed', 'c7d-founder-approval-bypassed',
      'c7d-repository-allowlist-removed', 'c7d-token-permissions-broadened', 'c7d-endpoint-allowlist-removed', 'c7d-unknown-outcome-retried', 'c7d-replay-not-recognized', 'c7d-expected-head-guard-removed', 'c7d-protection-gate-removed', 'c7d-checks-ignored',
      'c7d-preview-sandbox-removed', 'c7d-preview-on-founder-host', 'c7d-preview-host-check-removed', 'c7d-preview-serves-source', 'c7d-preview-integrity-ignored',
      'c7d-seo-score-introduced', 'c7d-social-version-check-removed', 'c7d-schedule-window-unbound', 'c7d-forbidden-capability-declared', 'c7d-hosting-preview-production-collapsed', 'c7d-rollback-unbound',
    ],
  },
  // R1 Independent Core Review: one mutation per fixed finding (docs/R1_INDEPENDENT_CORE_REVIEW_REPORT.md).
  // L1-01 live-provider foundation (docs/L1_01_IMPLEMENTATION_REPORT.md).
  [L1_MUTATION_CHECK]: {
    script: 'l1:mutation',
    ids: [
      'l1-vault-plaintext', 'l1-vault-secret-on-command-line', 'l1-vault-piped-secret-accepted',
      'l1-provider-arbitrary-url', 'l1-provider-follows-redirect', 'l1-provider-endpoint-allowlist-removed', 'l1-thinking-e4-not-max', 'l1-request-leaks-provider-request', 'l1-reasoning-effort-nested-in-thinking', 'l1-reasoning-effort-not-allowlisted', 'l1-reasoning-class-dropped', 'l1-recorded-message-does-not-end-run',
      'l1-other-model-answer-accepted', 'l1-cache-report-inconsistent-accepted', 'l1-non-string-content-accepted',
      'l1-401-retried', 'l1-402-transient', 'l1-timeout-marked-not-sent',
      'l1-alias-drift-ignored-adapter', 'l1-alias-drift-ignored-provisioning',
      'l1-cache-hit-billed-as-miss', 'l1-off-peak-ignored', 'l1-holiday-ignored', 'l1-reservation-below-worst-case', 'l1-cached-above-input-accepted', 'l1-settlement-ignores-actual-cost',
      'l1-profile-d3-egress-accepted',
      'l1-02-lifecycle-active-offered',
      'l1-02-occupied-seat-hireable',
      'l1-02-name-unshaped',
      'l1-02-package-digest-unchecked',
      'l1-02-model-access-d3',
      'l1-02-install-preview-unqualified',
      'l1-02-activation-without-calibration',
      'l1-02-evaluator-types-deterministic',
      'l1-02-static-review-ignored',
      'l1-02-baseline-sees-skill',
      'l1-02-answer-any-task',
      'l1-02-answer-run-not-ended',
      'l1-02-benchmark-failing-case-passes',
      'l1-02-package-skill-identity-duplicated',
      'l1-02-package-version-unchained',
      'l1-02-package-label-rewritable',
      'l1-02-package-view-digest-unbound',
      'l1-02-package-version-not-forward',
      'l1-02-answer-semantics-missing',
      'l1-02-invalid-output-unrecorded',
      'l1-02-v2-ceiling-tight',
      'l1-02-finalize-rolled-back',
      'l1-02-finalize-preview-untruthful',
      'l1-02-finalize-reruns-scored',
      'l1-02-reversible-semantics-missing',
      'l1-02-reversible-semantics-auxiliary',
      'l1-02-v3-label-reused',
      'l1-02-v3-payload-drift',
      'l1-02-bqm2-retry-escalates',
      'l1-02-bqm2-runtime-escalates',
      'l1-02-bqm2-k-reduced',
      'l1-02-bqm2-overall-layer-dropped',
      'l1-02-bqm2-critical-layer-dropped',
      'l1-02-bqm2-forbidden-tolerated',
      'l1-02-bqm2-n1-widened',
      'l1-02-r2-question-exemption-broad',
      'l1-02-r2-start-boundary-dropped',
      'l1-02-r1-reinterpreted',
      'l1-02-bqm2-invalid-made-void',
      'l1-02-bqm2-inflight-pin-unchecked',
      'l1-02-bqm2-pins-unchecked',
      'l1-02-ac4-contract-unrecorded',
      'l1-02-ac4-authority-semantics-missing',
      'l1-02-ac4-founder-decision-semantics-missing',
      'l1-02-bqm2-preview-bound-untruthful',
      'l1-02-bqm2-preview-text-untruthful',
      'l1-02-answer-only-fence-dropped',
      'l1-02-answer-only-not-pinned',
      'l1-02-wrong-type-mislabelled',
      'l1-02-answer-refusal-not-output-failure',
      'l1-02-call-bound-unenforced-processor',
      'l1-02-call-bound-unenforced-store',
      'l1-02-void-inferred-from-completion',
      'l1-02-void-inferred-from-unlisted-code',
      'l1-02-unclassified-preview-unchecked',
      'l1-02-preview-answer-only-unstated',
      'l1-02-answer-only-prompt-generic',
      'l1-02-answer-only-prompt-everywhere',
      'l1-02-output-instruction-unpinned',
      'l1-02-v4-method-unpinned',
      'l1-02-v4-label-reused',
      'l1-02-v4-unregistered',
      'l1-02-reuse-failed-version',
      'l1-02-reuse-incomplete-evidence',
      'l1-02-reuse-bqm1-evidence',
      'l1-02-reuse-fingerprint-unchecked',
      'l1-02-reuse-payload-unchecked',
      'l1-02-reuse-held-retired',
      'l1-02-reuse-integrity-ignored',
      'l1-02-reuse-requalified',
      'l1-02-reuse-preview-overcounts',
      'l1-02-reuse-approves-early',
      'l1-02-install-failed-new-skill',
      'l1-02-fingerprint-ignores-cases',
      'l1-02-fingerprint-ignores-method',
      'l1-02-v5-unregistered',
      'l1-02-v5-reuse-dropped',
      'l1-02-v5-reuses-failed',
      'l1-02-v5-revision-dropped',
      'l1-02-v5-label-reused',
      'l1-02-v6-unregistered',
      'l1-02-v6-reuse-dropped',
      'l1-02-v6-reuses-failed',
      'l1-02-v6-revision-dropped',
      'l1-02-v6-label-reused',
      'l1-02-v7-unregistered',
      'l1-02-v7-reuse-dropped',
      'l1-02-v7-reuses-failed',
      'l1-02-v7-revision-dropped',
      'l1-02-v7-label-reused',
      'l1-02-v7-language-kept',
      'l1-02-answer-manifest-unbound',
      'l1-02-answer-unspent-manifest',
      'l1-02-answer-scenario-unchecked',
      'l1-02-evaluation-without-answer',
      'l1-02-evaluation-answer-unbound',
      'l1-02-evaluate-answer-not-rechecked',
    ],
  },
  [R1_MUTATION_CHECK]: {
    script: 'r1:mutation',
    ids: [
      'r1-01-tool-result-secret-stored', 'r1-01-step-result-bounded-before-scan', 'r1-01-step-result-key-guard-dropped', 'r1-06-stale-pending-masks-decision', 'r1-12-stale-knowledge-eligible', 'r1-01-secret-instructions-sent', 'r1-01-detector-misses-hyphenated-keys', 'r1-02-tool-args-inherited-field', 'r1-03-step-base-ignored', 'r1-03-step-range-unbounded', 'r1-09-store-contention-blamed-on-provider', 'r1-09-over-bounds-usage-not-blamed', 'r1-09-provider-fault-hold-not-durable', 'r1-09-malformed-answer-hold-split', 'r1-09-uncontained-violator-routable', 'r1-09-charged-violation-verdict-dropped', 'r1-09-uncontained-filter-removed', 'r1-09-unusable-usage-hold-split', 'r1-09-charged-unusable-usage-not-contained', 'r1-09-lazy-answer-read-escapes', 'r1-09-boundary-field-read-twice', 'r1-09-boundary-class-unlisted', 'r1-09-disposition-prototype-key', 'r1-09-control-marker-forgeable', 'r1-09-charged-attempt-retried', 'r1-09-failure-class-read-twice',
      'r1-04-governed-reconciliation-unauthenticated', 'r1-05-approval-releases-unresolved-dependencies', 'r1-06-c2-wait-not-rechecked', 'r1-07-grant-does-not-wake-gap', 'r1-08-active-runs-keyed-by-job', 'r1-09-accounting-failure-escapes',
      'r1-09-settle-backstop-removed', 'r1-10-new-attempt-voids-refusal', 'r1-10-withdrawal-voids-refusal', 'r1-10-cancelled-shadow-refusal-skipped', 'r1-11-paused-reassignment-keeps-duty', 'r1-11-on-leave-reassignment-unchecked',
      'r1-12-eligibility-after-limit', 'r1-12-rejection-evidence-dropped', 'r1-12-conflict-pool-dropped', 'r1-12-conflict-pool-unrestricted', 'r1-13-lower-layer-forges-marker', 'r1-final-decision-not-checkpointed', 'r1-unbounded-proposal-code',
      // R2-10 / R2-12 (R2 cluster K3): the tool-driver boundary and the run-failure vocabulary.
      'r2-10-raw-tool-answer-passed-on', 'r2-10-tool-result-not-reparsed', 'r2-10-secret-driver-code-recorded', 'r2-10-storage-code-unscreened', 'r2-10-storage-rereads-outcome', 'r2-10-storage-guard-reads-driver-object',
      'r2-12-local-settlement-blamed-on-provider', 'r2-12-vocabulary-incomplete', 'r2-12-pg11-family-invented',
      // R2-03 (R2 cluster K2): a budget wait resumes on real headroom.
      'r2-03-freed-headroom-wakes-nothing', 'r2-03-budget-wake-ignores-headroom', 'r2-03-budget-recheck-ignores-freed-headroom',
      // RR2-1 (second-wave cluster Q1): a budget wait resumes on the need its refusal recorded.
      'rr2-1-budget-wake-ignores-recorded-need', 'rr2-1-budget-need-not-recorded', 'rr2-1-budget-wake-ignores-fresh-run-cap',
      // FA-1 (R2 architecture correction): budget capacity is admitted, not broadcast.
      'fa1-admission-not-subtracted', 'fa1-reservation-ignores-admissions', 'fa1-release-not-readmitted', 'fa1-admission-never-consumed', 'fa1-job-exit-keeps-admission',
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
// L1-02: `academy-packages` is the Academy package lifecycle (qualify → benchmark → install), a C3 storage module behind
// the Founder-authority write path (D-L1-13); it joins the C3 writers.
const MIND_WRITERS = ['mind-core', 'mind-writes', 'memory', 'skill-registry', 'academy', 'capability', 'academy-packages', 'academy-feedback'].map((m) => `packages/storage/src/${m}.ts`);
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
      // D1 (Task Contract §3): the icon's provenance record names the one-time source of the approved brand asset. It
      // is a record, never a build or runtime dependency; every other file stays free of the App repository.
      const found = files
        .filter((f) => f !== DESKTOP_ICON_PROVENANCE && scanned(f) && appPath.test(read(f) ?? ''))
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
    // C5: the loopback Founder listener and the browser UI are the two exceptions (rule `founder-listener-loopback-only`);
    // C7-D adds the isolated Preview host (rule `c7d-preview-isolated`) and the one fixed-host GitHub transport (`c7d-tool-boundary`).
    check: ({ files, read }) =>
      files
        .filter((f) => /^packages\/[^/]+\/src\//.test(f) && isCode(f) && f !== FOUNDER_LISTENER && f !== C7D_PREVIEW && f !== C7D_TRANSPORT && f !== L1_TRANSPORT && f !== L1_VAULT && f !== OPS_HOST_PROBE && f !== OPS_HOST_PROCESSES && f !== OPS_DESKTOP_CONTROL && f !== OPS_HOST_HANDOFF && !f.startsWith(UI_SRC) && NETWORK_MODULE.test(read(f) ?? ''))
        .map((f) => `${f} opens a network path or spawns processes (C1 runtime code has neither)`),
  },
  {
    id: 'runtime-dependencies-allowlisted',
    check: ({ files, read }) =>
      allManifests({ files, read }).flatMap(([f, m]) => {
        const deps = Object.keys({ ...m.dependencies, ...m.optionalDependencies, ...m.peerDependencies });
        if (f === 'package.json') return deps.map((d) => `root package.json declares runtime dependency ${d} (devDependencies only)`);
        const allowed = [...ALLOWED_RUNTIME_DEPENDENCIES, ...(ALLOWED_PACKAGE_DEPENDENCIES[f] ?? [])];
        return deps.filter((d) => !d.startsWith('@qandeel-company/') && !allowed.includes(d)).map((d) => `${f} depends on ${d}, which is not an allowlisted runtime dependency`);
      }),
  },
  {
    id: 'founder-listener-loopback-only',
    // C5 (Stage 12 §47–§49): the one listener binds 127.0.0.1 only, never a wildcard or LAN address; nothing
    // else in the surface package imports a network module; the UI loads no remote asset (no CDN, no font
    // host, no analytics) and never spawns processes or touches SQLite.
    check: ({ files, read }) => {
      const problems = [];
      const listener = read(FOUNDER_LISTENER);
      if (listener !== undefined) {
        if (!/host:\s*LOOPBACK_HOST/.test(listener) || !/LOOPBACK_HOST\s*=\s*'127\.0\.0\.1'/.test(read('packages/command-center/src/security.ts') ?? '')) problems.push(`${FOUNDER_LISTENER} does not bind the loopback host constant (127.0.0.1)`);
        if (/['"](?:0\.0\.0\.0|::|::0)['"]/.test(listener) || /\.listen\(\s*\d/.test(listener)) problems.push(`${FOUNDER_LISTENER} binds a non-loopback address`);
        if (/child_process|worker_threads|node:sqlite/.test(listener)) problems.push(`${FOUNDER_LISTENER} spawns processes or reaches SQLite`);
      }
      for (const f of files.filter((x) => x.startsWith('packages/command-center/src/') && x !== FOUNDER_LISTENER && x !== C7D_PREVIEW && x !== OPS_HOST_PROBE && x !== OPS_HOST_PROCESSES && x !== OPS_HOST_HANDOFF && x !== OPS_DESKTOP_CONTROL && isCode(x))) {
        if (NETWORK_MODULE.test(read(f) ?? '')) problems.push(`${f} opens a network path outside the loopback listener`);
      }
      for (const f of files.filter((x) => (x.startsWith(UI_SRC) || x.startsWith('packages/command-center-ui/public/')) && /\.(?:[cm]?[jt]s|html|css)$/i.test(x))) {
        const text = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*|<!--).*$/gm, '');
        if (REMOTE_URL.test(text)) problems.push(`${f} references a remote URL (the Founder UI loads no remote asset)`);
        if (/node:(?:sqlite|child_process|fs|net|http)/.test(text)) problems.push(`${f} imports a Node module in the browser UI`);
      }
      return problems;
    },
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
      const ci = fullMutationSuites(read);
      if (!/\bc1:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c1:mutation');
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
        .filter((f) => isCode(f) && !BUDGET_WRITERS.includes(f) && !isTestPath(f) && BUDGET_WRITE.test(read(f) ?? ''))
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
    // Nothing implements the Founder Command Center / Founder ↔ CEO conversation (C5), dashboards (C6) or
    // APP-OPS (C7) before its work package: no such tables, views or packages.
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
      const ci = fullMutationSuites(read);
      if (!/\bc2:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c2:mutation');
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
      const ci = fullMutationSuites(read);
      if (!/\bc3:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c3:mutation');
      return problems;
    },
  },
  {
    id: 'mutation-checks-pinned',
    // R1-15: a mutation check replaced by a comment, or a recorded mutation removed together with its
    // gate, must fail CI. Scripts may only grow; each keeps the machinery that makes a catch meaningful.
    check: ({ files, read }) => {
      const problems = [];
      const ci = fullMutationSuites(read);
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
        if (!new RegExp(`\\b${pin.script}\\b`).test(ci)) problems.push(`the FULL CI mutation matrix (both operating systems) does not run ${pin.script}`);
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
    id: 'c4-proofs-present',
    check: ({ files, read }) => {
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C4_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(C4_MUTATION_CHECK)) problems.push(`missing ${C4_MUTATION_CHECK}`);
      const ci = fullMutationSuites(read);
      if (!/\bc4:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c4:mutation');
      return problems;
    },
  },
  {
    id: 'c4-not-claimed-closed',
    // C4 is an implementation candidate; it is closed only in the change that adds its record, and C5 / C6 /
    // C7 do not start before it.
    check: ({ files, read }) => {
      if (files.some((f) => C4_CLOSURE.test(f))) return [];
      const problems = [];
      const map = read(IMPLEMENTATION_MAP);
      const c4 = mapState(map, 'C4');
      if (c4 !== undefined && /\bCLOSED\b/i.test(c4.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`C4 is marked ${JSON.stringify(c4)} but no docs/C4_*CLOSURE*.md record exists`);
      const report = read(C4_REPORT);
      if (report !== undefined && /\bC4\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${C4_REPORT} claims C4 is closed without a closure record`);
      for (const id of ['C5', 'C6', 'C7']) {
        const st = mapState(map, id);
        if (st !== undefined && st !== 'Not started') problems.push(`${id} is ${JSON.stringify(st)} before C4 has a closure record`);
      }
      return problems;
    },
  },
  {
    id: 'c5-proofs-present',
    check: ({ files, read }) => {
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C5_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(C5_MUTATION_CHECK)) problems.push(`missing ${C5_MUTATION_CHECK}`);
      const ci = fullMutationSuites(read);
      if (!/\bc5:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c5:mutation');
      return problems;
    },
  },
  {
    id: 'c5-not-claimed-closed',
    // C5 is an implementation candidate; it is closed only in the change that adds its record, and C6 / C7 /
    // R2 do not start before it. No Stage 16 source is invented meanwhile (authority-import-integrity).
    check: ({ files, read }) => {
      if (files.some((f) => C5_CLOSURE.test(f))) return [];
      const problems = [];
      const map = read(IMPLEMENTATION_MAP);
      const c5 = mapState(map, 'C5');
      if (c5 !== undefined && /\bCLOSED\b/i.test(c5.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`C5 is marked ${JSON.stringify(c5)} but no docs/C5_*CLOSURE*.md record exists`);
      const report = read(C5_REPORT);
      if (report !== undefined && /\bC5\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${C5_REPORT} claims C5 is closed without a closure record`);
      for (const id of ['C6', 'R2', 'C7']) {
        const st = mapState(map, id);
        if (st !== undefined && st !== 'Not started') problems.push(`${id} is ${JSON.stringify(st)} before C5 has a closure record`);
      }
      return problems;
    },
  },
  {
    id: 'c6-proofs-present',
    check: ({ files, read }) => {
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C6_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(C6_MUTATION_CHECK)) problems.push(`missing ${C6_MUTATION_CHECK}`);
      const ci = fullMutationSuites(read);
      if (!/\bc6:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c6:mutation');
      return problems;
    },
  },
  {
    id: 'c6-not-claimed-closed',
    // C6 is an implementation candidate; it is closed only in the change that adds its record, and R2 / C7 do not
    // start before it.
    check: ({ files, read }) => {
      if (files.some((f) => C6_CLOSURE.test(f))) return [];
      const problems = [];
      const map = read(IMPLEMENTATION_MAP);
      const c6 = mapState(map, 'C6');
      if (c6 !== undefined && /\bCLOSED\b/i.test(c6.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`C6 is marked ${JSON.stringify(c6)} but no docs/C6_*CLOSURE*.md record exists`);
      const report = read(C6_REPORT);
      if (report !== undefined && /\bC6\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${C6_REPORT} claims C6 is closed without a closure record`);
      for (const id of ['R2', 'C7']) {
        const st = mapState(map, id);
        if (st !== undefined && st !== 'Not started') problems.push(`${id} is ${JSON.stringify(st)} before C6 has a closure record`);
      }
      return problems;
    },
  },
  {
    id: 'c6-no-universal-score',
    // Stage 17 Founder Decision 1: a Performance Profile is multi-dimensional; no universal score, rank or
    // leaderboard exists in production code or in the schema.
    check: ({ files, read }) =>
      files
        .filter((f) => ((/^packages\/[^/]+\/src\//.test(f) && isCode(f)) || (f.startsWith(MIGRATIONS_DIR) && f.endsWith('.sql'))) && UNIVERSAL_SCORE.test((read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*|--).*$/gm, '')))
        .map((f) => `${f} introduces a universal score, rank or leaderboard (Stage 17 FD-1)`),
  },
  {
    id: 'c6-telemetry-content-free',
    // Rule A for C6: reflections, lesson content, rationale, Goal text and the recovery passphrase never enter
    // audit, events or logs.
    check: ({ files, read }) =>
      files
        .filter((f) => (C6_WRITERS.includes(f) || f === CLI_SOURCE) && isCode(f) && C6_CONTENT_IN_TELEMETRY.test(read(f) ?? ''))
        .map((f) => `${f} passes content into audit / events / logs (Rule A)`),
  },
  {
    id: 'c6-recovery-secret-never-stored',
    // Stage 15 D15-B.4: the portable package is AES-256-GCM authenticated ciphertext; the recovery passphrase is
    // operator-held material that is never written, recorded, logged or taken from a command line.
    check: ({ files, read }) => {
      const problems = [];
      const src = read(RESILIENCE_MODULE);
      if (src === undefined) return files.includes(RESILIENCE_MODULE) ? [] : [`missing ${RESILIENCE_MODULE}`];
      if (!/aes-256-gcm/.test(src) || !/setAuthTag\(/.test(src) || !/scryptSync\(/.test(src)) problems.push(`${RESILIENCE_MODULE} lost authenticated encryption (AES-256-GCM with a scrypt-derived key)`);
      for (const line of src.split('\n')) if (/passphrase/i.test(line) && /\b(?:INSERT|UPDATE|appendAudit|appendEvent|writeFileSync|put\(|console\.)/.test(line)) problems.push(`${RESILIENCE_MODULE} writes the recovery passphrase somewhere`);
      const cli = read(CLI_SOURCE) ?? '';
      if (/\bpassphrase\s*:\s*\{\s*type\s*:/.test(cli)) problems.push(`${CLI_SOURCE} takes the recovery passphrase from the command line`);
      return problems;
    },
  },
  {
    id: 'external-outcomes-governed',
    // C7-A replaces the pre-C7 guard ("EXTERNAL_OUTCOMES_AVAILABLE = false" until C7) with stronger rules: there is no
    // static availability flag at all (availability is durable source / evidence truth); every outcome verification
    // runs the governed external-evidence rule; the one usable-evidence predicate keeps all four conditions; and any
    // migration that creates external evidence also creates the datastore triggers that re-check it.
    check: ({ files, read }) => {
      const problems = [];
      const kernel = read(EVALUATION_KERNEL);
      if (kernel !== undefined && /\bEXTERNAL_OUTCOMES_AVAILABLE\b/.test(kernel.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, ''))) problems.push(`${EVALUATION_KERNEL} declares a static external-outcome availability flag (availability is governed runtime evidence)`);
      const outcome = read(OUTCOME_CORE);
      if (outcome !== undefined && !/\btxAssertExternalEvidence\(ctx, w\.id, input\.classes, input\.refs\);/.test(outcome)) problems.push(`${OUTCOME_CORE} records an outcome without the governed external-evidence rule`);
      const core = read(EXTERNAL_CORE);
      if (core !== undefined) for (const why of C7A_USABLE_REASONS) if (!core.includes(`'${why}'`)) problems.push(`${EXTERNAL_CORE} lost the usable-evidence condition ${why}`);
      // D-C7A-11: the evaluator reads only a CURRENT verification (a contested or retracted one is history, never truth).
      const evidence = read(IMPROVEMENT_CORE);
      if (evidence !== undefined && /\bexport function gatherWorkEvidence\b/.test(evidence) && !/\bconst verdict = recorded\?\.current \? recorded : null;/.test(evidence)) problems.push(`${IMPROVEMENT_CORE} lets the evaluator trust a verification that is not current truth (contested / retracted)`);
      const sql = files.filter((f) => f.startsWith(MIGRATIONS_DIR) && f.endsWith('.sql')).map((f) => read(f) ?? '').join('\n');
      if (/\bCREATE\s+TABLE\s+external_records\b/i.test(sql)) {
        for (const t of C7A_GOVERNED_TRIGGERS) if (!new RegExp(`\\bCREATE\\s+TRIGGER\\s+${t}\\b`).test(sql)) problems.push(`external evidence exists without the governed datastore trigger ${t}`);
      }
      return problems;
    },
  },
  {
    id: 'c7a-not-claimed-closed',
    // C7-A is an implementation candidate until independent exact-head review and merge: it is closed only in the change
    // that adds docs/C7A_*CLOSURE*.md, and its later sibling sub-stages (C7-B, C7-C, C7-D) do not start before it.
    check: ({ files, read }) => {
      if (files.some((f) => C7A_CLOSURE.test(f))) return [];
      const problems = [];
      const map = read(IMPLEMENTATION_MAP);
      const c7a = mapState(map, 'C7-A');
      if (c7a !== undefined && /\bCLOSED\b/i.test(c7a.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`C7-A is marked ${JSON.stringify(c7a)} but no docs/C7A_*CLOSURE*.md record exists`);
      const report = read(C7A_REPORT);
      if (report !== undefined && /\bC7-A\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${C7A_REPORT} claims C7-A is closed without a closure record`);
      for (const id of ['C7-B', 'C7-C', 'C7-D']) {
        const st = mapState(map, id);
        if (st !== undefined && st !== 'Not started') problems.push(`${id} is ${JSON.stringify(st)} before C7-A has a closure record`);
      }
      return problems;
    },
  },
  {
    id: 'c7a-proofs-present',
    check: ({ files, read }) => {
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C7A_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(C7A_MUTATION_CHECK)) problems.push(`missing ${C7A_MUTATION_CHECK}`);
      const ci = fullMutationSuites(read);
      if (!/\bc7a:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c7a:mutation');
      return problems;
    },
  },
  {
    id: 'c7a-intake-content-free',
    // Rules A / B / C at the intake: the intake payload, its fields and values, the producer identity and any user
    // pseudonym never enter audit, events or logs; storage, runtime and the Founder surface never name the pseudonym
    // (it exists only inside the kernel's identity fingerprint); no C7-A table has a raw-payload, user or secret column.
    check: ({ files, read }) => {
      const problems = files
        .filter((f) => (EXTERNAL_WRITERS.includes(f) || f === INTAKE_KERNEL || f === OUTCOME_CORE) && isCode(f) && C7A_CONTENT_IN_TELEMETRY.test(read(f) ?? ''))
        .map((f) => `${f} passes intake content into audit / events / logs (Rule A)`);
      for (const f of files.filter((x) => /^packages\/(?:storage|runtime|command-center|command-center-ui|mind)\/src\//.test(x) && isCode(x))) {
        if (/userPseudonym|user_pseudonym/.test(read(f) ?? '')) problems.push(`${f} handles a user pseudonym (only the intake kernel may, for the fingerprint)`);
      }
      for (const f of files.filter((x) => x.startsWith(MIGRATIONS_DIR) && x.endsWith('.sql'))) {
        for (const m of (read(f) ?? '').matchAll(/CREATE\s+TABLE\s+(external_\w+)\s*\(([\s\S]*?)\n\)\s*STRICT/g)) {
          const col = C7A_FORBIDDEN_COLUMN.exec(m[2] ?? '');
          if (col) problems.push(`${f}: ${m[1]} declares ${col[1]} (no raw payload, user reference or secret is stored)`);
        }
      }
      return problems;
    },
  },
  {
    id: 'external-evidence-writes-confined',
    // Governed source / record / conflict / binding state changes only in the C7-A storage modules; runtime code and
    // the CLI never register, activate, bind or ingest (Founder acts and the producer seam) — the CLI is read-only.
    check: ({ files, read }) => {
      const problems = files
        .filter((f) => isCode(f) && !EXTERNAL_WRITERS.includes(f) && !isTestPath(f) && EXTERNAL_WRITE.test(read(f) ?? ''))
        .map((f) => `${f} writes governed external-evidence state outside the C7-A storage modules`);
      for (const f of files.filter((x) => (x.startsWith('packages/runtime/src/') || x === CLI_SOURCE) && isCode(x))) {
        if (/\.(?:registerSource|decideSource|bindEvidence|unbindEvidence|ingest)\s*\(/.test(read(f) ?? '')) problems.push(`${f} registers, decides, binds or ingests (Founder acts and the producer seam are never runtime / CLI commands)`);
      }
      return problems;
    },
  },
  {
    id: 'c7a-extends-c6-only',
    // External evidence flows Evidence → Outcome Verification → C6 evaluation → attribution → learning / reporting:
    // C7-A creates no parallel evaluation / learning / performance / report store, and its modules never write a
    // verdict, an evaluation, an attribution, a lesson, a report or a Work Item state.
    check: ({ files, read }) => [
      ...files.filter((f) => f.startsWith(MIGRATIONS_DIR) && f.endsWith('.sql')).flatMap((f) => {
        const m = (read(f) ?? '').match(C7A_PARALLEL_TABLE);
        return m ? [`${f} creates ${m[1]} (C7-A extends the C6 engine; it never duplicates it)`] : [];
      }),
      ...files.filter((f) => (EXTERNAL_WRITERS.includes(f) || f === INTAKE_KERNEL) && isCode(f) && C7A_VERDICT_WRITE.test(read(f) ?? '')).map((f) => `${f} writes a verdict / evaluation / attribution / Work Item state (evidence is never a verdict)`),
    ],
  },
  {
    id: 'c7-later-scope-not-leaked',
    // No separate Pilot objective engine (C7-C binds the canonical Goals) and no publishing, website editing, social connector or campaign management
    // (C7-D) anywhere — not in code, not in schema. The App control families (C7-B) exist only in the C7-B kernel, store
    // and migration: no other module grows a second control path.
    check: ({ files, read }) =>
      files
        .filter((f) => (/^packages\/[^/]+\/src\//.test(f) && isCode(f)) || (f.startsWith(MIGRATIONS_DIR) && f.endsWith('.sql')))
        .flatMap((f) => {
          const text = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*|--).*$/gm, '');
          if (C7_LATER_SCOPE.test(text)) return [`${f} implements a later C7 sub-stage (C7-C pilot objectives or C7-D publishing / connectors)`];
          if (!C7B_FILES.includes(f) && C7B_SCOPE.test(text)) return [`${f} implements App control families outside the C7-B control plane modules`];
          return [];
        }),
  },
  {
    id: 'c7b-not-claimed-closed',
    // C7-B is an implementation candidate until independent exact-head review and merge: it is closed only in the change
    // that adds docs/C7B_*CLOSURE*.md, and C7-C / C7-D do not start before it.
    check: ({ files, read }) => {
      if (files.some((f) => C7B_CLOSURE.test(f))) return [];
      const problems = [];
      const map = read(IMPLEMENTATION_MAP);
      const c7b = mapState(map, 'C7-B');
      if (c7b !== undefined && /\bCLOSED\b/i.test(c7b.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`C7-B is marked ${JSON.stringify(c7b)} but no docs/C7B_*CLOSURE*.md record exists`);
      const report = read(C7B_REPORT);
      if (report !== undefined && /\bC7-B\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${C7B_REPORT} claims C7-B is closed without a closure record`);
      if (c7b !== undefined) {
        for (const id of ['C7-C', 'C7-D']) {
          const st = mapState(map, id);
          if (st !== undefined && st !== 'Not started') problems.push(`${id} is ${JSON.stringify(st)} before C7-B has a closure record`);
        }
      }
      return problems;
    },
  },
  {
    id: 'c7b-proofs-present',
    check: ({ files, read }) => {
      if (!files.includes(C7B_KERNEL) && !files.includes(C7B_MIGRATION)) return [];
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C7B_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(C7B_MUTATION_CHECK)) problems.push(`missing ${C7B_MUTATION_CHECK}`);
      const ci = fullMutationSuites(read);
      if (!/\bc7b:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c7b:mutation');
      return problems;
    },
  },
  {
    id: 'c7b-control-plane-governed',
    // Exactly the seven approved families (kernel and datastore); the production Remote Configuration register empty
    // (no migration seeds an approved family); every datastore gate present; ISSUED is the only Company state; a control
    // act is decided at R3 through the org-act boundary; the issuing hook sits in the approval engine only; writes to the
    // control tables only in the C7-B store.
    check: ({ files, read }) => {
      const problems = [];
      const kernel = read(C7B_KERNEL);
      if (kernel !== undefined) {
        const fam = /export const CONTROL_FAMILIES = \[([^\]]*)\] as const;/.exec(kernel);
        const listed = fam ? [...fam[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]) : null;
        if (listed === null || listed.join() !== C7B_FAMILIES.join()) problems.push(`${C7B_KERNEL} declares control families other than exactly the seven approved ones`);
        if (!/export const PRODUCTION_REMOTE_CONFIG_FAMILIES: readonly RemoteConfigFamily\[\] = Object\.freeze\(\[\]\);/.test(kernel)) problems.push(`${C7B_KERNEL}: the production Remote Configuration register is not empty (a family needs Product Owner + Architecture approval)`);
        if (!/export const APP_CONTROL_RISK = 'R3';/.test(kernel)) problems.push(`${C7B_KERNEL}: a Company → App control is not R3 (independent review AND Founder approval)`);
        if (/\b(?:app|remote)[.-]execute\b/.test(kernel)) problems.push(`${C7B_KERNEL} names a generic execution capability`);
      }
      const sql = files.filter((f) => f.startsWith(MIGRATIONS_DIR) && f.endsWith('.sql')).map((f) => read(f) ?? '').join('\n');
      if (/\bCREATE\s+TABLE\s+app_control_revisions\b/i.test(sql)) {
        for (const t of C7B_GOVERNED_TRIGGERS) if (!new RegExp(`\\bCREATE\\s+TRIGGER\\s+${t}\\b`).test(sql)) problems.push(`the control plane exists without the governed datastore trigger ${t}`);
        const chk = /family\s+TEXT\s+NOT NULL PRIMARY KEY CHECK \(family IN \(([^)]*)\)\)/.exec(sql);
        if (!chk || [...chk[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).join() !== C7B_FAMILIES.join()) problems.push('the datastore family catalogue is not exactly the seven approved families');
        if (!/company_state\s+TEXT\s+NOT NULL CHECK \(company_state = 'ISSUED'\)/.test(sql)) problems.push('an issued revision may hold a Company state other than ISSUED');
        if (/\bINSERT\s+INTO\s+app_remote_config_families\b/i.test(sql)) problems.push('a migration seeds an approved Remote Configuration family without Product + Architecture authority');
      }
      for (const f of files.filter((x) => C7B_FILES.includes(x))) {
        const text = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*|--).*$/gm, '').replace(/'[^'\n]*'/g, (q) => (/^'(?:APPLIED|ACKNOWLEDGED|DELIVERED|EFFECTIVE_IN_APP|LIVE_IN_APP|ACTIVE_IN_APP|APPLIED_IN_APP)'$/.test(q) ? q : "''"));
        if (C7B_EFFECT_CLAIM.test(text)) problems.push(`${f} records an App-applied / effective state (the Company states what it ISSUED; the App owns effect)`);
      }
      const orgWrites = read('packages/storage/src/org-writes.ts');
      if (orgWrites !== undefined && files.includes(C7B_STORE) && !/decideEmployeeAction\('EMPLOYEE', actingState\(ctx, fence\.runId, e\), grants, \{ capability, resource: req\.resource, risk: req\.risk,/.test(orgWrites)) problems.push('org-writes.ts no longer decides a control act at its R3 risk on its family');
      const gov = read('packages/storage/src/governance.ts');
      if (gov !== undefined && files.includes(C7B_STORE) && !/if \(a\.action === APP_CONTROL_APPROVAL_ACTION\) txControlApprovalDecided\(ctx, a, to, p\.ref\);/.test(gov)) problems.push('a control is no longer issued by the Founder\'s R3 approval decision');
      const writes = /\b(?:UPDATE|INSERT\s+(?:OR\s+\w+\s+)?INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+app_(?:control|remote_config)\w*/i;
      for (const f of files.filter((x) => isCode(x) && !isTestPath(x) && x !== C7B_STORE)) if (writes.test(read(f) ?? '')) problems.push(`${f} writes control-plane state outside ${C7B_STORE}`);
      for (const f of files.filter((x) => (x.startsWith('packages/runtime/src/') || x === CLI_SOURCE || x.startsWith('packages/command-center/src/')) && isCode(x))) {
        if (/\b(?:txProposeControl|txControlApprovalDecided|txControlReviewSettled|txControlReviewStale|recoverControlReviews)\b/.test(read(f) ?? '')) problems.push(`${f} reaches the control plane's internal writes (controls are proposed by Employee acts and issued only by the Founder's approval)`);
      }
      return problems;
    },
  },
  {
    id: 'c7b-no-generic-execution',
    // PO-OPS-08 / PO-OPS-19: a control is typed data, never code. No C7-B module evaluates, spawns, imports dynamically or
    // opens a network path; nothing in it stores a secret, key or signature (a digest is a fingerprint, not authentication).
    check: ({ files, read }) => {
      const problems = [];
      for (const f of files.filter((x) => C7B_FILES.includes(x))) {
        const text = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*|--).*$/gm, '');
        if (f.endsWith('.ts') && C7B_EXECUTION.test(text)) problems.push(`${f} can execute, spawn or reach the network (no generic remote execution)`);
        const col = /^\s*"?(\w*(?:secret|token|credential|password|api_?key|private_?key|signing|signature|transcript|prompt|conversation|user_id|email|phone)\w*)"?\s+(?:TEXT|BLOB|ANY|INTEGER|REAL)\b/im.exec(f.endsWith('.sql') ? text : '');
        if (col) problems.push(`${f} declares ${col[1]} (no secret, key, signature or private-content column in the control plane)`);
      }
      return problems;
    },
  },
  {
    id: 'c7b-roles-separate',
    // PO-OPS-09: the App Operations & Release Lead is its own vacant Product seat under the Product Director. The release
    // never merges it with the App Store Release & Reputation Lead, never edits that seat, never hires, assigns or grants.
    check: ({ read }) => {
      const sql = read(C7B_MIGRATION);
      if (sql === undefined) return [];
      const problems = [];
      if (!/INSERT INTO org_positions[\s\S]*?'product\.app-operations-release-lead', 'QANDEEL App Operations & Release Lead', 'DEPARTMENT', d\.id, 'LEAD'/.test(sql)) problems.push(`${C7B_MIGRATION} does not create the distinct App Operations & Release Lead LEAD seat`);
      if (!/dir\.code = 'director\.product'/.test(sql)) problems.push(`${C7B_MIGRATION}: the seat does not report to the Product Director`);
      if (/\bUPDATE\s+org_positions\b/i.test(sql) || /\bUPDATE[^;]*app-store-release-reputation-lead/i.test(sql)) problems.push(`${C7B_MIGRATION} changes an existing seat (the App Store Release & Reputation Lead stays as it is)`);
      if (/\bINSERT\s+INTO\s+(?:employees|position_assignments|permission_grants|authority_delegations)\b/i.test(sql)) problems.push(`${C7B_MIGRATION} hires, assigns or grants (a seat is vacant and grants nothing)`);
      return problems;
    },
  },
  {
    id: 'c7b-intake-refusals-bounded',
    // R-C7A-04 (Company-side part): a refused intake is audited only as the first of its (source, reason, window) counter;
    // the counter key is a registered source or `unresolved`, never a supplied string.
    check: ({ read }) => {
      const store = read(EXTERNAL_STORE);
      const sql = read(C7B_MIGRATION);
      if (store === undefined || sql === undefined) return [];
      const problems = [];
      if (!/if \(txCountRefusal\(ctx, refused\.sourceId \?\? named \?\? 'unresolved', reason\)\) appendAudit\(ctx, 'external\.intake_rejected'/.test(store)) problems.push(`${EXTERNAL_STORE} audits refused intake without the bounded refusal counter`);
      if (!/\bCREATE\s+TRIGGER\s+external_intake_refusal_windows_bounded_key\b/.test(sql)) problems.push(`${C7B_MIGRATION}: refusal counters are not bounded to registered sources`);
      return problems;
    },
  },
  {
    id: 'c7c-requires-c7b-closure',
    // C7-C starts only after C7-B is closed in repository truth: a C7-C module needs docs/C7B_*CLOSURE*.md.
    check: ({ files }) => (files.some((f) => C7C_FILES.includes(f)) && !files.some((f) => C7B_CLOSURE.test(f)) ? ['C7-C modules exist but C7-B has no docs/C7B_*CLOSURE*.md record'] : []),
  },
  {
    id: 'c7c-not-claimed-closed',
    // C7-C is an implementation candidate until independent exact-head review and merge: it is closed only in the change
    // that adds docs/C7C_*CLOSURE*.md, and C7-D does not start before it.
    check: ({ files, read }) => {
      if (files.some((f) => C7C_CLOSURE.test(f))) return [];
      const problems = [];
      const map = read(IMPLEMENTATION_MAP);
      const c7c = mapState(map, 'C7-C');
      if (c7c !== undefined && /\bCLOSED\b/i.test(c7c.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`C7-C is marked ${JSON.stringify(c7c)} but no docs/C7C_*CLOSURE*.md record exists`);
      const report = read(C7C_REPORT);
      if (report !== undefined && /\bC7-C\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${C7C_REPORT} claims C7-C is closed without a closure record`);
      if (c7c !== undefined) {
        const st = mapState(map, 'C7-D');
        if (st !== undefined && st !== 'Not started') problems.push(`C7-D is ${JSON.stringify(st)} before C7-C has a closure record`);
      }
      return problems;
    },
  },
  {
    id: 'c7c-proofs-present',
    check: ({ files, read }) => {
      if (!files.some((f) => C7C_FILES.includes(f))) return [];
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C7C_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(C7C_MUTATION_CHECK)) problems.push(`missing ${C7C_MUTATION_CHECK}`);
      const ci = fullMutationSuites(read);
      if (!/\bc7c:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c7c:mutation');
      return problems;
    },
  },
  {
    id: 'c7c-pilot-governed',
    // A Pilot is a Founder-decided context, never a second engine: every datastore gate present; the release creates only
    // the Pilot identity and history (no parallel evaluation / cost / review / learning store); no private-content,
    // secret or score column; Pilot state is written only by the C7-C store; runtime, CLI and the surface never reach the
    // store's internal step writers (the Founder moves a Pilot only through the store's Founder acts / the governed
    // confirmation); the readiness checklist has exactly the eight criteria and autonomy reads JUDGMENT + INDEPENDENCE.
    check: ({ files, read }) => {
      const problems = [];
      const sql = read(C7C_MIGRATION);
      if (sql !== undefined) {
        for (const t of C7C_GOVERNED_TRIGGERS) if (!new RegExp(`\\bCREATE\\s+TRIGGER\\s+${t}\\b`).test(sql)) problems.push(`the Pilot lifecycle exists without the datastore gate ${t}`);
        for (const m of sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)/gi)) if (!C7C_TABLES.includes(m[1] ?? '')) problems.push(`${C7C_MIGRATION} creates ${m[1]} (a Pilot derives everything else from the canonical tables)`);
        for (const m of sql.matchAll(/CREATE\s+TABLE\s+(pilot\w*)\s*\(([\s\S]*?)\n\)\s*STRICT/g)) {
          const col = C7C_FORBIDDEN_COLUMN.exec(m[2] ?? '');
          if (col) problems.push(`${C7C_MIGRATION}: ${m[1]} declares ${col[1]} (no private content, secret or score in a Pilot)`);
        }
      }
      const writes = /\b(?:UPDATE|INSERT\s+(?:OR\s+\w+\s+)?INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+pilot(?:s|_history)\b/i;
      for (const f of files.filter((x) => isCode(x) && !isTestPath(x) && x !== C7C_STORE)) if (writes.test(read(f) ?? '')) problems.push(`${f} writes Pilot state outside ${C7C_STORE}`);
      for (const f of files.filter((x) => (x.startsWith('packages/runtime/src/') || x === CLI_SOURCE || x.startsWith('packages/command-center/src/')) && isCode(x))) {
        if (/\b(?:txCreatePilot|txAdvancePilot|planPilotStep)\b/.test(read(f) ?? '')) problems.push(`${f} reaches the Pilot store's internal step writers (a Pilot moves only by the Founder's own act)`);
      }
      const evidence = read(C7C_EVIDENCE);
      if (evidence !== undefined) {
        const crit = /export const READINESS_CRITERIA = \[([^\]]*)\] as const;/.exec(evidence);
        if (!crit || [...(crit[1] ?? '').matchAll(/'([A-Z_]+)'/g)].length !== 8) problems.push(`${C7C_EVIDENCE}: the readiness checklist is not exactly the eight criteria`);
        if (!/export const AUTONOMY_DIMENSIONS: readonly PerformanceDimension\[\] = \['JUDGMENT', 'INDEPENDENCE'\];/.test(evidence)) problems.push(`${C7C_EVIDENCE}: appropriate autonomy reads other than JUDGMENT + INDEPENDENCE`);
      }
      return problems;
    },
  },
  {
    id: 'c7c-no-c7d-or-network',
    // C7-C never publishes, reaches the network, claims an App effect or implements C7-D (website, SEO, social, hosting,
    // domains, campaigns): those are Digital Presence Creation & Operations, a later sub-stage.
    check: ({ files, read }) => {
      const problems = [];
      for (const f of files.filter((x) => C7C_FILES.includes(x))) {
        const text = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*|--).*$/gm, '');
        if (f.endsWith('.ts') && (NETWORK_MODULE.test(text) || REMOTE_URL.test(text))) problems.push(`${f} opens a network path (C7-C has none)`);
        if (C7D_SCOPE.test(text)) problems.push(`${f} implements C7-D scope (website / publishing / social / SEO / hosting / campaigns)`);
        if (C7B_EFFECT_CLAIM.test(text.replace(/'[^'\n]*'/g, "''"))) problems.push(`${f} claims an App-applied / effective state (an issued control is desired state only)`);
      }
      return problems;
    },
  },
  {
    id: 'c7d-requires-c7c-closure',
    // C7-D starts only after C7-C is closed in repository truth: a C7-D module needs docs/C7C_*CLOSURE*.md.
    check: ({ files }) => (files.some((f) => C7D_FILES.includes(f) || f.startsWith(C7D_DRIVERS)) && !files.some((f) => C7C_CLOSURE.test(f)) ? ['C7-D modules exist but C7-C has no docs/C7C_*CLOSURE*.md record'] : []),
  },
  {
    id: 'c7d-not-claimed-closed',
    // C7-D is an implementation candidate until independent exact-head review and merge: it is closed only in the change
    // that adds docs/C7D_*CLOSURE*.md. No report or map may claim the QANDEEL website built or a vendor chosen.
    check: ({ files, read }) => {
      const problems = [];
      const report = read(C7D_REPORT);
      if (report !== undefined && C7D_CLAIMED_BUILT.test(report.replace(/\b(?:not|never|no)\s+(?:been\s+)?/gi, ' NEGATED '))) problems.push(`${C7D_REPORT} claims the QANDEEL website built or a vendor selected`);
      if (files.some((f) => C7D_CLOSURE.test(f))) return problems;
      const st = mapState(read(IMPLEMENTATION_MAP), 'C7-D');
      if (st !== undefined && /\bCLOSED\b/i.test(st.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`C7-D is marked ${JSON.stringify(st)} but no docs/C7D_*CLOSURE*.md record exists`);
      if (report !== undefined && /\bC7-D\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${C7D_REPORT} claims C7-D is closed without a closure record`);
      return problems;
    },
  },
  {
    id: 'c7d-proofs-present',
    check: ({ files, read }) => {
      if (!files.some((f) => C7D_FILES.includes(f))) return [];
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = C7D_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(C7D_MUTATION_CHECK)) problems.push(`missing ${C7D_MUTATION_CHECK}`);
      const ci = fullMutationSuites(read);
      if (!/\bc7d:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run c7d:mutation');
      return problems;
    },
  },
  {
    id: 'c7d-digital-governed',
    // The workshop is identity and exact binding over the Artifact Store, never a second engine: every datastore gate
    // present; only the digital tables created; no content / blob / secret / score column; digital state written only by
    // the C7-D store; the internal catalogue's actions are typed (no generic execution word); promotions keep no review,
    // approval or execution state of their own; nothing C7-D writes evaluations, attributions, learning or external evidence.
    check: ({ files, read }) => {
      const problems = [];
      const sql = read(C7D_MIGRATION);
      if (sql !== undefined) {
        for (const t of C7D_GOVERNED_TRIGGERS) if (!new RegExp(`\\bCREATE\\s+TRIGGER\\s+${t}\\b`).test(sql)) problems.push(`the digital workshop exists without the datastore gate ${t}`);
        for (const m of sql.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)/gi)) if (!C7D_TABLES.includes(m[1] ?? '')) problems.push(`${C7D_MIGRATION} creates ${m[1]} (C7-D reuses the canonical Work / Review / Approval / Cost / Pilot tables)`);
        for (const m of sql.matchAll(/CREATE\s+TABLE\s+(digital\w*)\s*\(([\s\S]*?)\n\)\s*STRICT/g)) {
          const col = C7D_FORBIDDEN_COLUMN.exec(m[2] ?? '');
          if (col) problems.push(`${C7D_MIGRATION}: ${m[1]} declares ${col[1]} (file content stays in the Artifact Store; no secret or score)`);
          if (/\bBLOB\b/i.test(m[2] ?? '')) problems.push(`${C7D_MIGRATION}: ${m[1]} declares a BLOB column (content stays in the Artifact Store)`);
          if (/\b(?:review_state|approval_state|approved|executed_state|review_request_id|approval_id|invocation_id)\b/.test(m[2] ?? '')) problems.push(`${C7D_MIGRATION}: ${m[1]} stores review / approval / execution state (it is derived from the canonical rows)`);
        }
        for (const m of sql.matchAll(/\('c7d00000-[0-9a-f-]+', 'c7d00000-0000-4000-8000-000000000001', '([a-z-]+)'/g)) if (/(?:^|-)(?:shell|exec|execute|eval|cmd|command|run|script|spawn|http|fetch|request|anything)(?:-|$)/.test(m[1] ?? '')) problems.push(`${C7D_MIGRATION}: the internal catalogue names a generic execution action (${m[1]})`);
      }
      const writes = /\b(?:UPDATE|INSERT\s+(?:OR\s+\w+\s+)?INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+digital_\w+/i;
      for (const f of files.filter((x) => isCode(x) && !isTestPath(x) && x !== C7D_STORE && !x.startsWith(MIGRATIONS_DIR))) if (writes.test(read(f) ?? '')) problems.push(`${f} writes digital workshop state outside ${C7D_STORE}`);
      const store = read(C7D_STORE);
      if (store !== undefined && /\b(?:UPDATE|INSERT\s+(?:OR\s+\w+\s+)?INTO|DELETE\s+FROM)\s+(?:evaluation_results|causal_attributions|learning_signals|lessons|external_records|external_bindings|outcome_verifications|approvals|review_requests|review_decisions|tool_invocations|pilots)\b/i.test(store)) problems.push(`${C7D_STORE} writes a canonical review / approval / execution / evaluation / evidence / Pilot table (it reads them)`);
      for (const f of files.filter((x) => (C7D_FILES.includes(x) || x.startsWith(C7D_DRIVERS)) && isCode(x))) {
        const text = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
        if (C7D_SUCCESS_CLAIM.test(text)) problems.push(`${f} claims publication as an outcome or market success`);
      }
      return problems;
    },
  },
  {
    id: 'c7d-tool-boundary',
    // External effects only through the Tool Executor and explicit, versioned adapters: no driver reaches the store, the
    // runtime, SQLite or the filesystem; the GitHub adapter requests only the declared least-privilege permissions, has a
    // closed endpoint allowlist (no DELETE / PATCH, no admin / protection / secret area), never forces, never follows
    // redirects and talks to one fixed host; the internal workshop driver code is reserved.
    check: ({ files, read }) => {
      const problems = [];
      for (const f of files.filter((x) => x.startsWith(C7D_DRIVERS) && isCode(x))) {
        const text = read(f) ?? '';
        if (/from\s+['"]@qandeel-company\/(?:storage|runtime|command-center|mind)['"]|node:sqlite|node:fs|node:child_process|worker_threads/.test(text)) problems.push(`${f} reaches the store, the runtime, the filesystem or processes (a driver gets only its resolved candidate)`);
        if (/\bforce\s*:\s*true\b|['"]force['"]\s*:/.test(text)) problems.push(`${f} forces a ref update`);
        if (f !== C7D_TRANSPORT && (NETWORK_MODULE.test(text) || REMOTE_URL.test(text.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '')))) problems.push(`${f} opens a network path outside the one approved transport`);
      }
      const transport = read(C7D_TRANSPORT);
      if (transport !== undefined) {
        if (!/const GITHUB_API_ORIGIN = 'https:\/\/api\.github\.com';/.test(transport) || [...transport.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].some((m) => m[0] !== 'https://api.github.com')) problems.push(`${C7D_TRANSPORT} talks to a host other than the fixed GitHub API origin`);
        if (!/redirect:\s*'error'/.test(transport)) problems.push(`${C7D_TRANSPORT} follows redirects`);
        if (!/assertGitHubEndpoint\(request\.method, request\.path\)/.test(transport)) problems.push(`${C7D_TRANSPORT} sends without the endpoint allowlist`);
      }
      const decl = read(C7D_GITHUB_DECLARATION);
      if (decl !== undefined) {
        const perms = /GITHUB_TOKEN_PERMISSIONS[^=]*=\s*Object\.freeze\(\{([^}]*)\}\)/.exec(decl);
        if (!perms) problems.push(`${C7D_GITHUB_DECLARATION}: the token permissions are not one frozen literal`);
        else for (const m of (perms[1] ?? '').matchAll(/(\w+)\s*:/g)) if (!['contents', 'pull_requests', 'checks', 'statuses', 'metadata'].includes(m[1] ?? '')) problems.push(`${C7D_GITHUB_DECLARATION}: requests the ${m[1]} permission (least privilege: contents, pull_requests, checks, statuses, metadata)`);
      }
      const endpoints = read(C7D_GITHUB_ENDPOINTS);
      if (endpoints !== undefined) {
        const allowed = /const ALLOWED[\s\S]*?\n\];/.exec(endpoints)?.[0] ?? '';
        if (/method:\s*'(?:DELETE|PATCH)'/.test(allowed)) problems.push(`${C7D_GITHUB_ENDPOINTS} allows DELETE / PATCH`);
        if (/protection|collaborators|secrets|\/hooks|\/keys|admin/.test(allowed)) problems.push(`${C7D_GITHUB_ENDPOINTS} allows an administration / protection / secret endpoint`);
      }
      for (const f of files.filter((x) => /^packages\/[^/]+\/src\//.test(x) && isCode(x) && x !== C7D_KERNEL && x !== TOOL_EXECUTOR && x !== C7D_STORE)) {
        if (/['"]company\.digital-workspace['"]/.test(read(f) ?? '')) problems.push(`${f} names the reserved internal workshop driver (only the kernel, the store and the Tool Executor may)`);
      }
      return problems;
    },
  },
  {
    id: 'c7d-preview-isolated',
    // The internal Preview is untrusted code on its own loopback site: 127.0.0.2 (never the Founder surface's host, never
    // a wildcard or LAN address), every response sandboxed without allow-same-origin, no network / forms / workers, never
    // a cookie, noindex; it never reaches SQLite or spawns processes.
    check: ({ read }) => {
      const problems = [];
      const raw = read(C7D_PREVIEW);
      if (raw === undefined) return problems;
      const p = raw.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
      if (!/export const PREVIEW_HOST = '127\.0\.0\.2';/.test(p) || !/host:\s*PREVIEW_HOST/.test(p)) problems.push(`${C7D_PREVIEW} does not bind the preview's own loopback host (127.0.0.2)`);
      if (/['"](?:0\.0\.0\.0|::|::0|127\.0\.0\.1|localhost)['"]/.test(p)) problems.push(`${C7D_PREVIEW} binds or names the Founder surface's host or a non-loopback address`);
      if (!/sandbox allow-scripts;/.test(p) || /allow-same-origin|allow-forms|allow-top-navigation|allow-popups/.test(p)) problems.push(`${C7D_PREVIEW}: responses are not sandboxed to an opaque origin`);
      for (const d of ["connect-src 'none'", "form-action 'none'", "worker-src 'none'", 'noindex']) if (!p.includes(d)) problems.push(`${C7D_PREVIEW}: missing ${d}`);
      if (/Set-Cookie|req\.headers\.cookie|parseCookies/i.test(p)) problems.push(`${C7D_PREVIEW} reads or sets a cookie`);
      if (/node:sqlite|child_process|worker_threads|node:fs/.test(p)) problems.push(`${C7D_PREVIEW} reaches SQLite, the filesystem or processes`);
      return problems;
    },
  },
  {
    id: 'c7d-no-vendor-preselection',
    // C7-D builds the capability; the Company researches and recommends the stack later. No C7-D module names a website
    // framework, hosting provider, CMS, analytics, SEO vendor or social platform (GitHub is the one approved code host).
    check: ({ files, read }) => {
      const problems = [];
      for (const f of files.filter((x) => (C7D_FILES.includes(x) || x.startsWith(C7D_DRIVERS)) && isCode(x))) {
        const text = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*|--).*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const m = C7D_VENDOR.exec(text);
        if (m) problems.push(`${f} names ${m[0]} (no website / hosting / CMS / analytics / SEO / social vendor is preselected in C7-D)`);
      }
      return problems;
    },
  },
  {
    id: 'founder-session-scope-confined',
    // C5 (D-C5-03): a Founder ref is still not authentication. The production session scope is entered only by
    // the auth module; the surface package and the runtime never arm the chokepoint themselves, never mint or
    // redeem a session outside the auth store, and the CLI still offers no Founder write command.
    check: ({ files, read }) => {
      const problems = [];
      for (const f of files.filter((x) => /^packages\/[^/]+\/src\//.test(x) && isCode(x))) {
        const text = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
        if (f !== FOUNDER_AUTH && f !== 'packages/storage/src/governance.ts' && /\bfounderSessionInternals\b/.test(text)) problems.push(`${f} reaches the Founder session scope internals (only ${FOUNDER_AUTH} may)`);
        if (f.startsWith('packages/command-center/src/') && /founder:[0-9a-f-]{36}|founder:unauthenticated/.test(text)) problems.push(`${f} carries a literal Founder reference (a ref is not authentication)`);
        if (f.startsWith('packages/command-center/src/') && /INSERT\s+INTO\s+founder_sessions|UPDATE\s+founder_sessions/.test(text)) problems.push(`${f} writes sessions outside the auth store`);
      }
      const auth = read(FOUNDER_AUTH);
      if (auth !== undefined) {
        // The session INSERT binds only hashes: a bare `cookieValue` / `csrf` / `token` argument (not wrapped in `hash(`)
        // would store the secret itself.
        if (!/token_sha256/.test(auth) || /INSERT INTO founder_sessions[^;]*?(?<!hash\()\b(?:cookieValue|csrf|token)\s*[,)]/.test(auth)) problems.push(`${FOUNDER_AUTH} must store session tokens as SHA-256 hashes only`);
        if (!/SameSite|revokeAll|expires_at/.test(auth + (read('packages/command-center/src/security.ts') ?? ''))) problems.push('the Founder surface lacks session expiry / revocation / SameSite cookies');
      }
      const cli = read('packages/command-center/src/cli.ts');
      if (cli !== undefined && /case\s+['"](?:approve|reject|register-founder|decide|confirm)['"]/.test(cli)) problems.push('packages/command-center/src/cli.ts exposes a Founder write command (a ref is not authentication)');
      return problems;
    },
  },
  {
    id: 'c5-telemetry-content-free',
    // Rule A for C5: message bodies, briefs, goal titles / summaries, command text never enter audit, events or logs.
    check: ({ files, read }) =>
      files
        .filter((f) => (C5_WRITERS.includes(f) || f.startsWith('packages/command-center/src/')) && isCode(f) && C5_CONTENT_IN_TELEMETRY.test(read(f) ?? ''))
        .map((f) => `${f} passes content into audit / events / logs (Rule A)`),
  },
  {
    id: 'organization-writes-confined',
    // Durable C4 state changes only in the C4 storage modules; model output reaches it only through the
    // fenced runtime-authority acts; runtime code and the CLI never call a Founder organization / review act;
    // the storage index never re-exports the fenced C4 writes or internals.
    check: ({ files, read }) => {
      const problems = files
        .filter((f) => isCode(f) && !ORG_WRITERS.includes(f) && !isTestPath(f) && ORG_WRITE.test(read(f) ?? ''))
        .map((f) => `${f} writes organization / delegation / review state outside the C4 storage modules`);
      for (const f of files.filter((x) => x.startsWith('packages/runtime/src/') && isCode(x))) {
        if (ORG_FOUNDER_CALL.test(read(f) ?? '')) problems.push(`${f} calls a Founder organization / review act (model output never assigns, delegates authority or decides a review)`);
      }
      const index = (read('packages/storage/src/index.ts') ?? '').replace(/^\s*\/\/.*$/gm, '');
      if (/org-writes|review-core|org-core/.test(index)) problems.push('packages/storage/src/index.ts re-exports the fenced C4 writes or internals');
      return problems;
    },
  },
  {
    id: 'c4-telemetry-content-free',
    // Rule A: C4 audit, events and logs carry IDs, states, counts and codes — never staffing evidence,
    // handoff messages, review rationale or reviewer instructions.
    check: ({ files, read }) =>
      files
        .filter((f) => (ORG_WRITERS.includes(f) || f === 'packages/storage/src/org-records.ts' || f.startsWith('packages/runtime/src/c4/') || f === 'packages/governance/src/organization.ts' || f === 'packages/governance/src/review.ts') && isCode(f))
        .filter((f) => C4_CONTENT_IN_TELEMETRY.test(read(f) ?? '') || CONTENT_IN_TELEMETRY.test(read(f) ?? ''))
        .map((f) => `${f} passes content into audit / events / logs (Rule A)`),
  },
  {
    id: 'r4-never-review-satisfied',
    // Execute ≠ Review ≠ Approve, R4 sovereign: a review request can never be satisfied or consumed for an R4
    // subject (datastore CHECK), and the authority kernel keeps R4 Founder-only before any review path.
    check: ({ files, read }) => {
      const problems = [];
      for (const f of files.filter((x) => x.startsWith(MIGRATIONS_DIR) && x.endsWith('.sql'))) {
        const sql = read(f) ?? '';
        if (/\bCREATE\s+TABLE\s+review_requests\b/i.test(sql) && !R4_REVIEW_CHECK.test(sql)) problems.push(`${f} creates review_requests without the R4 CHECK (a review never satisfies R4)`);
      }
      const kernel = read(AUTHORITY_KERNEL);
      if (kernel !== undefined && !/if \(req\.risk === 'R4'\) return \{ effect: 'DENY', code: 'FOUNDER_ONLY' \};/.test(kernel)) problems.push(`${AUTHORITY_KERNEL} no longer keeps R4 Founder-only before any review`);
      return problems;
    },
  },
  {
    id: 'review-pool-not-department',
    // The Review Pool is a registry of qualified reviewers, never a Department; the seeded Department map is
    // exactly the canonical Strong-v1 five (Engineering the permanent fifth).
    check: ({ files, read }) => {
      const problems = [];
      for (const f of files.filter((x) => x.startsWith(MIGRATIONS_DIR) && x.endsWith('.sql'))) {
        const sql = read(f) ?? '';
        const seeded = [...sql.matchAll(/INSERT\s+INTO\s+departments\b[^;]*?SELECT\s+'[0-9a-f-]{36}',\s*'([a-z0-9-]+)'/gi)].map((m) => String(m[1]));
        for (const code of seeded) if (/review|reviewer|pool|oversight/.test(code)) problems.push(`${f} seeds a "${code}" Department (the Review Pool is not a Department)`);
        if (seeded.length > 0 && [...CANONICAL_DEPARTMENTS].sort().join() !== [...new Set(seeded)].sort().join()) problems.push(`${f} seeds Departments ${JSON.stringify(seeded)}, not the canonical five ${JSON.stringify(CANONICAL_DEPARTMENTS)}`);
      }
      return problems;
    },
  },
  // --- L1-01 rules ---------------------------------------------------------------------------------------------------
  {
    id: 'l1-requires-c7d-closure',
    // L1 starts only after C7-D is closed in repository truth: an L1 module needs docs/C7D_*CLOSURE*.md.
    check: ({ files }) => (files.some((f) => L1_FILES.includes(f) || f.startsWith(L1_VAULT_SRC) || f.startsWith(L1_PROVIDERS_SRC)) && !files.some((f) => C7D_CLOSURE.test(f)) ? ['L1 modules exist but C7-D has no docs/C7D_*CLOSURE*.md record'] : []),
  },
  {
    id: 'l1-not-claimed-closed',
    // L1-01 is an implementation candidate until independent exact-head review and merge; nothing claims a live provider
    // closed, or Strong v1 reached, without its record.
    check: ({ files, read }) => {
      if (files.some((f) => L1_CLOSURE.test(f))) return [];
      const problems = [];
      const st = mapState(read(IMPLEMENTATION_MAP), 'L1');
      if (st !== undefined && /\bCLOSED\b/i.test(st.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`L1 is marked ${JSON.stringify(st)} but no docs/L1_01_*CLOSURE*.md record exists`);
      const report = read(L1_REPORT);
      if (report !== undefined && /\bL1-01\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${L1_REPORT} claims L1-01 is closed without a closure record`);
      return problems;
    },
  },
  // --- L1-02 rules -------------------------------------------------------------------------------------------------
  {
    id: 'l1-02-requires-l1-01-closure',
    // L1-02 builds on a CLOSED L1-01: its modules need docs/L1_01_*CLOSURE*.md.
    check: ({ files }) => (files.some((f) => L1_02_FILES.includes(f)) && !files.some((f) => L1_CLOSURE.test(f)) ? ['L1-02 modules exist but L1-01 has no docs/L1_01_*CLOSURE*.md record'] : []),
  },
  {
    id: 'l1-02-not-claimed-closed',
    // L1-02 is an implementation candidate until independent exact-head review and merge; L1 as a whole is not closed by it.
    check: ({ files, read }) => {
      if (files.some((f) => L1_02_CLOSURE.test(f))) return [];
      const problems = [];
      const st = mapState(read(IMPLEMENTATION_MAP), 'L1');
      if (st !== undefined && /^\s*CLOSED\b/i.test(st)) problems.push(`L1 is marked ${JSON.stringify(st)} but no docs/L1_02_*CLOSURE*.md record exists`);
      const report = read(L1_02_REPORT);
      if (report !== undefined && /\bL1-02\s*(?:—|-|:|is)?\s*CLOSED\b/i.test(report.replace(/\bNOT\s+CLOSED\b/gi, ''))) problems.push(`${L1_02_REPORT} claims L1-02 is closed without a closure record`);
      return problems;
    },
  },
  {
    id: 'l1-02-proofs-present',
    // The production activation proofs CI must execute (found by marker) whenever the L1-02 modules exist.
    check: ({ files, read }) => {
      if (!files.some((f) => L1_02_FILES.includes(f))) return [];
      const tests = files.filter((f) => isTestPath(f) && isCode(f));
      return L1_02_PROOF_MARKERS.filter((m) => !tests.some((f) => (read(f) ?? '').includes(m))).map((m) => `no test carries the proof marker "${m}"`);
    },
  },
  {
    id: 'l1-02-benchmark-load-confined',
    // A SANDBOXED (unapproved) Skill version loads only through the one benchmark loader beside the pinned loader, and only
    // the context assembler calls it (inside the fenced SKILL_BENCHMARK mode). Production eligibility is never relaxed.
    check: ({ files, read }) =>
      files
        .filter((f) => isCode(f) && !isTestPath(f) && !L1_02_BENCH_LOADER_FILES.includes(f))
        .filter((f) => L1_02_BENCH_LOADER.test(read(f) ?? ''))
        .map((f) => `${f} reaches the benchmark skill loader; only the context assembler may (fenced SKILL_BENCHMARK mode)`),
  },
  {
    id: 'l1-02-activation-no-seam',
    // The production activation path never uses the test-only Founder seam or a raw Founder reference as authority.
    check: ({ files, read }) =>
      files
        .filter((f) => L1_02_FILES.includes(f) || f === 'packages/command-center/src/surface.ts' || /^scripts\/l1-02-[^/]*\.mjs$/.test(f))
        .filter((f) => /founderSurfaceInternals|testing\/founder-seam|activateEmployeeForTest|armFounderTestSurface|@qandeel-company\/storage\/testing|founder:unauthenticated/.test(read(f) ?? ''))
        .map((f) => `${f} reaches the test-only Founder seam: the production activation path is the authenticated Founder surface only`),
  },
  {
    id: 'l1-02-activation-structured-only',
    // No text produces an activation act: the classifier's verb grammar never names one, and the surface's text path
    // resolves each to no target (they are posted only as structured previews).
    check: ({ files, read }) => {
      if (!files.includes(L1_02_ACTIVATION)) return [];
      const intents = ['EMPLOYEE_REASONING_PROFILE', 'WORK_ITEM_REASONING_OVERRIDE', 'ACADEMY_FOUNDER_FEEDBACK', 'EMPLOYEE_HIRE', 'EMPLOYEE_LIFECYCLE', 'EMPLOYEE_MODEL_ACCESS', 'SKILL_PACKAGE_QUALIFY', 'ACADEMY_PACKAGE_INSTALL', 'ACADEMY_ENROLL', 'ACADEMY_MODULES_COMPLETE', 'ACADEMY_ATTEMPT_START', 'ACADEMY_EVALUATE', 'ACADEMY_RETRAIN_COMPLETE', 'ACADEMY_SHADOW_ASSIGN', 'ACADEMY_PROBATION_EVIDENCE', 'ACADEMY_PROBATION_REVIEW', 'ACADEMY_CALIBRATION', 'ACTIVATION_DECIDE'];
      const problems = [];
      const gov = read('packages/governance/src/founder.ts') ?? '';
      const actOf = /function actOf\([\s\S]*?\n\}/.exec(gov)?.[0] ?? '';
      for (const i of intents) if (actOf.includes(`'${i}'`)) problems.push(`the Founder verb grammar produces ${i} from text`);
      const api = read('packages/command-center/src/api.ts');
      if (api !== undefined) {
        const resolver = /function resolveMutatingTarget\([\s\S]*?\n\}/.exec(api)?.[0] ?? '';
        for (const i of intents) if (!new RegExp(`case '${i}':[\\s\\S]*?return null;`).test(resolver)) problems.push(`the surface's text path does not resolve ${i} to no target`);
      }
      return problems;
    },
  },
  {
    id: 'l1-proofs-present',
    // The L1 proofs CI must execute (found by marker), the mutation check, and the root ci script running it.
    check: ({ files, read }) => {
      if (!files.some((f) => L1_FILES.includes(f))) return [];
      const tests = files.filter((f) => /^packages\/[^/]+\/test\/.*\.test\.ts$/.test(f));
      const problems = L1_PROOF_MARKERS.filter((marker) => !tests.some((f) => (read(f) ?? '').includes(marker))).map((marker) => `no test carries the proof marker "${marker}"`);
      if (!files.includes(L1_MUTATION_CHECK)) problems.push(`missing ${L1_MUTATION_CHECK}`);
      const ci = fullMutationSuites(read);
      if (!/\bl1:mutation\b/.test(ci)) problems.push('the FULL CI mutation matrix (both operating systems) does not run l1:mutation');
      return problems;
    },
  },
  {
    id: 'l1-vault-protected',
    // The Windows vault (D-L1-02): DPAPI CurrentUser through the signed PowerShell host started by its absolute System32
    // path with a fixed argument list and no shell; the payload travels on stdin only; the blob directory is the user's
    // local application data; no network path; nothing else in the vault package starts a process; the CLI refuses a
    // secret on the command line, prompts in raw mode and never echoes; no vault module names a real key format.
    check: ({ files, read }) => {
      const problems = [];
      const vault = read(L1_VAULT);
      if (vault !== undefined) {
        const code = vault.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
        if (!/ProtectedData/.test(code) || !/CurrentUser/.test(code)) problems.push(`${L1_VAULT} does not protect with Windows DPAPI in the CurrentUser scope`);
        if (!/WindowsPowerShell['"]?,\s*['"]v1\.0['"]?,\s*['"]powershell\.exe/.test(code) || !/SystemRoot/.test(code)) problems.push(`${L1_VAULT} does not start the signed Windows PowerShell host by its absolute System32 path`);
        if (!/execFile\(/.test(code) || /\bexec\(|spawn\(|execSync\(|shell:\s*true/.test(code)) problems.push(`${L1_VAULT} starts a process through a shell or an unbounded exec`);
        if (!/shell:\s*false/.test(code)) problems.push(`${L1_VAULT} does not state shell: false`);
        if (!/-EncodedCommand/.test(code) || !/stdin/.test(code)) problems.push(`${L1_VAULT} does not pass the payload through the child's stdin with an encoded fixed command`);
        if (/--secret|--value|--key\b/.test(code)) problems.push(`${L1_VAULT} names a secret argument`);
        if (!/LOCALAPPDATA/.test(code)) problems.push(`${L1_VAULT} does not place the vault under the user's local application data`);
        if (/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|undici|sqlite)['"]|\bfetch\s*\(/.test(code)) problems.push(`${L1_VAULT} opens a network path or reaches SQLite`);
      }
      for (const f of files.filter((x) => x.startsWith(L1_VAULT_SRC) && isCode(x) && x !== L1_VAULT)) {
        if (/child_process|worker_threads/.test(read(f) ?? '')) problems.push(`${f} starts a process (only ${L1_VAULT} may, for DPAPI)`);
      }
      const cli = read(L1_VAULT_CLI);
      if (cli !== undefined) {
        if (!/FORBIDDEN_FLAGS/.test(cli) || !/secret|value|key|password|token/.test(cli)) problems.push(`${L1_VAULT_CLI} does not refuse a secret on the command line`);
        if (!/setRawMode\(true\)/.test(cli) || !/isTTY/.test(cli)) problems.push(`${L1_VAULT_CLI} does not prompt in raw mode on an interactive terminal (no echo, no pipe)`);
      }
      for (const f of files.filter((x) => x.startsWith('packages/secret-vault/') && isCode(x))) {
        if (/(?:from\s+|import\s*\(\s*)['"]@qandeel-company\/(?:storage|runtime|command-center)/.test(read(f) ?? '')) problems.push(`${f} reaches the Company store, runtime or surface (a vault holds references and values only)`);
      }
      return problems;
    },
  },
  // --- OPS rules ---------------------------------------------------------------------------------------------------
  {
    id: 'founder-host-confined',
    // OPS (D-OPS-03 / D-OPS-04): the host probe talks only to 127.0.0.1, only to the two host-control routes (never a
    // Founder /api route), and starts no process; the process module starts only the signed Node runtime, an absolute
    // browser path or the signed PowerShell host by its System32 path, never through a shell, and opens no network path;
    // the host descriptor holds a public key only (the private key is a private field and never exported).
    check: ({ read }) => {
      const problems = [];
      const strip = (t) => t.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
      const probe = read(OPS_HOST_PROBE);
      if (probe !== undefined) {
        const code = strip(probe);
        if (!/host:\s*LOOPBACK_HOST/.test(code)) problems.push(`${OPS_HOST_PROBE} does not connect to the loopback host constant`);
        if (/\bhost:(?!\s*LOOPBACK_HOST\b)/.test(code) || /\bhostname:/.test(code) || /\bfetch\s*\(/.test(code)) problems.push(`${OPS_HOST_PROBE} can reach a host other than 127.0.0.1`);
        if (/['"`]\/api\//.test(code)) problems.push(`${OPS_HOST_PROBE} reaches a Founder /api route (discovery and stop carry no Founder session)`);
        if (/child_process|worker_threads|node:sqlite|node:(?:net|tls|https|http2|dgram|dns)['"]/.test(code)) problems.push(`${OPS_HOST_PROBE} starts a process, reaches SQLite or opens a non-HTTP network path`);
      }
      const proc = read(OPS_HOST_PROCESSES);
      if (proc !== undefined) {
        const code = strip(proc);
        if (/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns|undici|sqlite|worker_threads)['"]|\bfetch\s*\(/.test(code)) problems.push(`${OPS_HOST_PROCESSES} opens a network path, reaches SQLite or starts a worker`);
        if (/shell:\s*true|\bexec\(|execSync\(|spawnSync\(|execFileSync\(|\bfork\(/.test(code)) problems.push(`${OPS_HOST_PROCESSES} starts a process through a shell or an unbounded exec`);
        if (!/shell:\s*false/.test(code)) problems.push(`${OPS_HOST_PROCESSES} does not state shell: false`);
        for (const m of code.matchAll(/\b(?:spawn|execFile)\(\s*([^,]+),/g)) {
          // D1 (D-D1-08): `installedRuntime` is the pinned official node.exe of a verified, installed Desktop bundle.
          if (!['process.execPath', 'browser.exe', 'powershellExe()', 'installedRuntime'].includes((m[1] ?? '').trim())) problems.push(`${OPS_HOST_PROCESSES} starts an executable other than the Node runtime, an installed browser or the signed PowerShell host (${(m[1] ?? '').trim()})`);
        }
        if (!/WindowsPowerShell['"]?,\s*['"]v1\.0['"]?,\s*['"]powershell\.exe/.test(code) || !/SystemRoot/.test(code) || !/-EncodedCommand/.test(code)) problems.push(`${OPS_HOST_PROCESSES} does not start the signed Windows PowerShell host by its absolute System32 path with an encoded fixed command`);
      }
      const handoff = read(OPS_HOST_HANDOFF);
      if (handoff !== undefined) {
        const code = strip(handoff);
        if (!/\.listen\(\s*0\s*,\s*LOOPBACK_HOST\b/.test(code) || /['"](?:0\.0\.0\.0|::|::0)['"]/.test(code)) problems.push(`${OPS_HOST_HANDOFF} does not bind a random loopback port only`);
        for (const [h, v] of [['sec-fetch-site', 'none'], ['sec-fetch-mode', 'navigate'], ['sec-fetch-dest', 'document']]) {
          if (!new RegExp(`header\\(req, '${h}'\\) === '${v}'`).test(code)) problems.push(`${OPS_HOST_HANDOFF} does not require ${h}: ${v} (only a user-started browser navigation receives the token)`);
        }
        if (!/header\(req, 'host'\) === `\$\{LOOPBACK_HOST\}:\$\{port\}`/.test(code)) problems.push(`${OPS_HOST_HANDOFF} does not require its exact loopback Host (DNS rebinding)`);
        if (/console\.|\blog\(|logger|req\.headers\)|JSON\.stringify\(req/.test(code)) problems.push(`${OPS_HOST_HANDOFF} logs or serializes the request (the browser sends its loopback cookies to every port)`);
        if (/child_process|worker_threads|node:sqlite|node:(?:net|tls|https|http2|dgram|dns)['"]|\bfetch\s*\(/.test(code)) problems.push(`${OPS_HOST_HANDOFF} starts a process, reaches SQLite or opens another network path`);
        if (!/server\.close\(\)/.test(code)) problems.push(`${OPS_HOST_HANDOFF} is not one-shot (it never closes after delivery)`);
      }
      // D-D2-01: the stopped-state desktop controller. Loopback only; its own window only (exact Host, required same-origin
      // fetch metadata, exact Origin); 256-bit single-use capability material compared in constant time; no Founder API, no
      // process of its own, no request logging; never a forced stop.
      const desk = read(OPS_DESKTOP_CONTROL);
      if (desk !== undefined) {
        const code = strip(desk);
        if (!/listen\(\{\s*host:\s*LOOPBACK_HOST,\s*port:\s*0\b/.test(code) || /['"](?:0\.0\.0\.0|::|::0)['"]/.test(code)) problems.push(`${OPS_DESKTOP_CONTROL} does not bind a random loopback port only`);
        if (!/facts\.host\.toLowerCase\(\) !== `\$\{LOOPBACK_HOST\}:\$\{port\}`/.test(code)) problems.push(`${OPS_DESKTOP_CONTROL} does not require its exact loopback Host (DNS rebinding, localhost)`);
        if (!/if \(facts\.secFetchSite !== 'same-origin'\) return \{ ok: false/.test(code)) problems.push(`${OPS_DESKTOP_CONTROL} does not require Sec-Fetch-Site: same-origin on every state change`);
        if (!/facts\.origin\.toLowerCase\(\) !== origin\) return \{ ok: false/.test(code)) problems.push(`${OPS_DESKTOP_CONTROL} does not require its exact Origin`);
        if (!/randomBytes\(32\)/.test(code) || !/timingSafeEqual\(/.test(code)) problems.push(`${OPS_DESKTOP_CONTROL} does not mint 256-bit capability material or compare it in constant time`);
        if (/['"`]\/api\//.test(code)) problems.push(`${OPS_DESKTOP_CONTROL} reaches a Founder /api route (it carries no Founder authority)`);
        if (/child_process|worker_threads|node:sqlite|node:(?:net|tls|https|http2|dgram|dns)['"]|\bfetch\s*\(/.test(code)) problems.push(`${OPS_DESKTOP_CONTROL} starts a process itself, reaches SQLite or opens another network path`);
        if (/console\.|req\.headers\)|JSON\.stringify\(req|\bticket\b[^\n]*#log\(|#log\([^\n]*\b(?:ticket|key|secret|launchUrl)\b\s*[,}:]/.test(code)) problems.push(`${OPS_DESKTOP_CONTROL} logs or serializes a request or a secret`);
        if (/stopHost\([^)]*force/.test(code) || /terminateProcess/.test(code)) problems.push(`${OPS_DESKTOP_CONTROL} can force-stop the Company (only an explicit Start-menu --force may)`);
      }
      // D-D2-01 (Founder-approved): the host gate's ONE same-site exception is loading the static launch page by a top-level
      // document navigation — exactly GET, exactly /launch, same-site, navigate, document — and it relaxes nothing else.
      const sec = read(OPS_SECURITY);
      if (sec !== undefined && /isLaunchPageNavigation/.test(sec)) {
        const code = strip(sec);
        const fn = /export function isLaunchPageNavigation\(facts: RequestFacts\): boolean \{\s*return ([^;]+);/.exec(code)?.[1] ?? '';
        const need = ["facts.method === 'GET'", 'facts.path === LAUNCH_PAGE_PATH', "facts.secFetchSite === 'same-site'", "facts.secFetchMode === 'navigate'", "facts.secFetchDest === 'document'"];
        if (need.some((n) => !fn.includes(n)) || /\|\||startsWith|includes|!==/.test(fn)) problems.push(`${OPS_SECURITY} widens the launch-page exception beyond a GET document navigation to exactly /launch`);
        if (!/export const LAUNCH_PAGE_PATH = '\/launch';/.test(code)) problems.push(`${OPS_SECURITY} names a launch-page path other than /launch`);
        if ((code.match(/isLaunchPageNavigation\(facts\)/g) ?? []).length !== 1 || !/facts\.secFetchSite !== 'none' && !isLaunchPageNavigation\(facts\)\) return \{ ok: false, status: 403, code: 'CROSS_SITE_REQUEST' \}/.test(code)) problems.push(`${OPS_SECURITY} applies the launch-page exception anywhere but the fetch-metadata check`);
      }
      const lifecycle = read(OPS_HOST_LIFECYCLE);
      if (lifecycle !== undefined) {
        const code = strip(lifecycle);
        for (const m of code.matchAll(/openBrowser\)?\(\s*([^)]*)\)/g)) {
          if ((m[1] ?? '').trim() !== 'handoff.url') problems.push(`${OPS_HOST_LIFECYCLE} opens the browser on something other than the one-shot handoff address (${(m[1] ?? '').trim()}): the launch credential would be a process argument`);
        }
      }
      const desc = read(OPS_HOST_DESCRIPTOR);
      if (desc !== undefined) {
        const code = strip(desc);
        if (!/readonly #privateKey/.test(code) || /pkcs8|privateKey\.export|type:\s*'pkcs1'/.test(code)) problems.push(`${OPS_HOST_DESCRIPTOR} can export or serialize the host's private key`);
        if (/child_process|node:(?:http|https|net|tls|sqlite)['"]|\bfetch\s*\(/.test(code)) problems.push(`${OPS_HOST_DESCRIPTOR} opens a network path, starts a process or reaches SQLite`);
      }
      return problems;
    },
  },
  {
    id: 'ops-release-admission',
    // OPS (D-OPS-08, Stage 12): a pinned production Company runs only its activated, intact release. The runtime checks it
    // at start BEFORE any open / safe-upgrade; a development build (no manifest) and an unreadable pin are refused, never
    // treated as unpinned; the Founder's shortcuts are written only for a release's CLI, never for the running checkout.
    check: ({ read }) => {
      const problems = [];
      const strip = (t) => t.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
      const runtime = read(OPS_RUNTIME);
      if (runtime !== undefined && read(OPS_RELEASE_ADMISSION) !== undefined) {
        const code = strip(runtime);
        const admit = code.indexOf('admitRuntimeRelease(this.#opts.workspace)');
        const open = code.indexOf('CompanyStore.open(this.#opts.workspace');
        const upgrade = code.indexOf('safeUpgrade(this.#opts.workspace');
        if (admit < 0 || (open >= 0 && admit > open) || (upgrade >= 0 && admit > upgrade)) problems.push(`${OPS_RUNTIME} does not admit the runtime release before it opens or upgrades the Company`);
      }
      const admission = read(OPS_RELEASE_ADMISSION);
      if (admission !== undefined) {
        const code = strip(admission);
        if (!/if \(pin === undefined\) return refuse\('PIN_INVALID'/.test(code)) problems.push(`${OPS_RELEASE_ADMISSION} does not refuse an unreadable pin`);
        if (!/if \(self === null\) return refuse\('NOT_A_RELEASE'/.test(code)) problems.push(`${OPS_RELEASE_ADMISSION} admits a non-release (development) build for a pinned Company`);
        if (!/releaseId !== pin\.releaseId\) return refuse\('NOT_ACTIVATED'/.test(code)) problems.push(`${OPS_RELEASE_ADMISSION} admits a release other than the activated one`);
        if (!/verifyReleaseTree\(self\)/.test(code) || !/hashReleaseTree\(root\)/.test(code)) problems.push(`${OPS_RELEASE_ADMISSION} does not re-verify every release file before admitting it`);
        if (/child_process|node:(?:http|https|net|tls|sqlite)['"]|\bfetch\s*\(/.test(code)) problems.push(`${OPS_RELEASE_ADMISSION} opens a network path, starts a process or reaches SQLite`);
      }
      for (const file of [OPS_CLI, OPS_RELEASE, DESKTOP_MODULE]) {
        const text = read(file);
        if (text === undefined) continue;
        for (const m of strip(text).matchAll(/\binstallShortcuts\(\s*([^,]+),/g)) {
          if (!/^releaseCli\(/.test((m[1] ?? '').trim()) && (m[1] ?? '').trim() !== 'cli') problems.push(`${file} writes the Founder shortcuts for something other than a release CLI (${(m[1] ?? '').trim()})`);
        }
      }
      const release = read(OPS_RELEASE);
      if (release !== undefined) {
        const code = strip(release);
        if (!/const cli = releaseCli\(root\)/.test(code)) problems.push(`${OPS_RELEASE} does not start the activated release's own CLI`);
        for (const step of ['verifyReleaseTree(releaseRoot)', "'release-check'", 'stopHost(workspace)', 'backupBeforeActivation(workspace)', 'writePin(workspace, before)']) {
          if (!code.includes(step)) problems.push(`${OPS_RELEASE} activation lacks the step ${step}`);
        }
      }
      return problems;
    },
  },
  {
    id: 'ops-proofs-present',
    // The Founder host proofs CI must execute (found by marker) whenever the host lifecycle modules exist.
    check: ({ files, read }) => {
      if (!files.some((f) => OPS_HOST_FILES.includes(f))) return [];
      const tests = files.filter((f) => isTestPath(f) && isCode(f));
      return OPS_PROOF_MARKERS.filter((m) => !tests.some((f) => (read(f) ?? '').includes(m))).map((m) => `no test carries the proof marker "${m}"`);
    },
  },
  {
    id: 'desktop-distribution',
    // D1 (D-D1-01 … D-D1-07): the Windows Desktop product is an orchestration shell over OPS. The installer is per-user
    // (no elevation, %LOCALAPPDATA%\Programs), versioned side by side, never changes PATH, registers no autostart, writes
    // no registry of its own, never deletes Company data and hands every Company operation to the canonical activation
    // (desktop-install / desktop-uninstall). The private runtime is an exactly pinned official Node 24 win-x64 build;
    // the icon is the pinned derivative of the ratified brand authority's frozen icon. The Desktop module verifies the
    // bundle and its own private runtime before anything else, never opens or creates a Company store, never writes a
    // pin itself and deletes nothing but its own product record. No generated binary is committed.
    check: ({ files, read }) => {
      const iss = read(DESKTOP_ISS);
      const pinsText = read(DESKTOP_PINS);
      const mod = read(DESKTOP_MODULE);
      if (iss === undefined && pinsText === undefined && mod === undefined) return [];
      const problems = [];
      for (const need of [DESKTOP_ISS, DESKTOP_PINS, DESKTOP_MODULE, DESKTOP_ICON_PROVENANCE, ...DESKTOP_PROOFS]) if (!files.includes(need)) problems.push(`missing ${need}`);
      const hex = /^[0-9a-f]{64}$/;
      const pins = json(pinsText ?? '') ?? {};
      if (!/^24\.\d+\.\d+$/.test(pins.node?.version ?? '') || pins.node?.platform !== 'win32' || pins.node?.arch !== 'x64') problems.push(`${DESKTOP_PINS}: the private runtime must be an exact Node 24 win32 x64 version`);
      if (!String(pins.node?.url ?? '').startsWith(`https://nodejs.org/dist/v${pins.node?.version}/win-x64/`) || !hex.test(pins.node?.sha256 ?? '') || !hex.test(pins.node?.licenseSha256 ?? '')) problems.push(`${DESKTOP_PINS}: the private runtime is not pinned to the official URL and SHA-256`);
      if (!/^\d+\.\d+\.\d+$/.test(pins.inno?.version ?? '') || !String(pins.inno?.url ?? '').startsWith('https://github.com/jrsoftware/issrc/releases/download/') || !hex.test(pins.inno?.sha256 ?? '')) problems.push(`${DESKTOP_PINS}: the Inno Setup compiler is not pinned (version, official release URL, SHA-256)`);
      const prov = json(read(DESKTOP_ICON_PROVENANCE) ?? '') ?? {};
      if (prov.sourceSha256 !== DESKTOP_ICON_SOURCE_SHA256 || !/I-08B2\.5/.test(prov.authority ?? '') || !hex.test(pins.icon?.sha256 ?? '') || prov.ico?.sha256 !== pins.icon?.sha256) problems.push(`${DESKTOP_PINS}: the icon is not the pinned derivative of the ratified I-08B2.5 app icon`);
      if (iss !== undefined) {
        const code = iss.split('\n').filter((l) => !l.trim().startsWith(';')).join('\n');
        if (!/^PrivilegesRequired=lowest\s*$/m.test(code) || /PrivilegesRequiredOverridesAllowed/.test(code)) problems.push(`${DESKTOP_ISS} is not a per-user, non-elevated installation`);
        if (!/^DefaultDirName=\{autopf\}\\/m.test(code)) problems.push(`${DESKTOP_ISS} does not install into the per-user program root`);
        if (!/^ChangesEnvironment=no\s*$/m.test(code)) problems.push(`${DESKTOP_ISS} may change the environment (PATH)`);
        if (/^\[(?:Registry|Icons|UninstallDelete|InstallDelete)\]/m.test(code)) problems.push(`${DESKTOP_ISS} writes registry / shortcuts / deletions of its own (the canonical code owns them)`);
        if (/CurrentVersion\\Run|\{(?:user|common)startup\}|\bDelTree\b|\bDeleteFile\b|\bRemoveDir\b|QANDEEL_COMPANY_DATA/i.test(code)) problems.push(`${DESKTOP_ISS} registers autostart or deletes / names Company data`);
        if (!/DestDir: "\{app\}\\versions\\\{#VersionDir\}"/.test(code)) problems.push(`${DESKTOP_ISS} does not install side by side (versioned directory)`);
        if (!code.includes('desktop-install --bundle') || !code.includes('desktop-uninstall')) problems.push(`${DESKTOP_ISS} does not hand install / uninstall to the canonical activation`);
        if (/\/p\s|\/csp\s|password/i.test(code)) problems.push(`${DESKTOP_ISS} carries a signing credential`);
      }
      if (mod !== undefined) {
        const code = mod.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
        const verify = code.indexOf('verifyDesktopBundle(bundleDir)');
        const activate = code.indexOf('activateRelease(');
        if (verify < 0 || activate < 0 || verify > activate || !code.includes("'PRIVATE_RUNTIME_REQUIRED'")) problems.push(`${DESKTOP_MODULE} activates before verifying the bundle and its private runtime`);
        if (!code.includes("'SETUP_REQUIRED'") || /CompanyStore|createBackup|writePin|writeReleasePin|seed/i.test(code)) problems.push(`${DESKTOP_MODULE} can create or write a Company (it only finds an existing one and uses the canonical activation)`);
        // It deletes only its own product record, and (D-D1-08) a staging / retired copy inside <program dir>\versions.
        for (const m of code.matchAll(/\brmSync\(\s*([^,]+)[,)]/g)) if (!['desktopProductRecordPath()', 'dir'].includes((m[1] ?? '').trim())) problems.push(`${DESKTOP_MODULE} deletes something other than its own product record or an installer staging copy (${(m[1] ?? '').trim()})`);
        if (/\brmSync\(\s*dir\b/.test(code) && !/staging\|retired/.test(code)) problems.push(`${DESKTOP_MODULE} removes a directory without the staging / retired guard`);
      }
      const proc = read(OPS_HOST_PROCESSES);
      if (proc !== undefined && /uninstallCommandLine/.test(proc)) {
        if (!/!isProductProgramDir\(programDir\)/.test(proc) || !/!userKey\(key\)/.test(proc) || !/\^HKCU:/.test(proc)) problems.push(`${OPS_HOST_PROCESSES} removes a program directory or registry key without the product-directory / per-user guard`);
      }
      for (const f of files.filter((x) => x.startsWith('packaging/') && /\.(?:exe|msi|zip|7z|dll|node)$/i.test(x))) problems.push(`${f}: a generated binary is committed`);
      return problems;
    },
  },
  {
    id: 'l1-provider-boundary',
    // The DeepSeek adapter (D-L1-03/D-L1-05): one fixed origin, no redirect, the endpoint allowlist re-checked before
    // every fetch, no other network path in the provider package, non-streaming, no provider tools, the E1–E4 → thinking
    // table exact, the bearer only in the transport, the chain-of-thought field never read in any src module, and the
    // adapter never reaches the Company store, runtime or surface.
    check: ({ files, read }) => {
      const problems = [];
      const transport = read(L1_TRANSPORT);
      if (transport !== undefined) {
        if (!/const DEEPSEEK_API_ORIGIN = 'https:\/\/api\.deepseek\.com';/.test(read(L1_DECLARATION) ?? '') || !/fetch\(`\$\{DEEPSEEK_API_ORIGIN\}\$\{request\.path\}`/.test(transport)) problems.push(`${L1_TRANSPORT} does not fetch the fixed DeepSeek origin`);
        if (!/redirect:\s*'error'/.test(transport)) problems.push(`${L1_TRANSPORT} follows redirects`);
        if (!/assertDeepSeekEndpoint\(request\.method, request\.path\)/.test(transport)) problems.push(`${L1_TRANSPORT} sends without the endpoint allowlist`);
      }
      for (const f of files.filter((x) => x.startsWith(L1_PROVIDERS_SRC) && isCode(x))) {
        const text = read(f) ?? '';
        const code = text.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
        if (f !== L1_TRANSPORT && (NETWORK_MODULE.test(code) || [...code.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].some((m) => !['https://api.deepseek.com', 'https://api-docs.deepseek.com'].includes(m[0])))) problems.push(`${f} opens a network path or names a host outside the one approved transport / the recorded pricing basis`);
        if (f !== L1_TRANSPORT && /Authorization|Bearer/.test(code)) problems.push(`${f} handles the bearer outside the transport`);
        if (/(?:from\s+|import\s*\(\s*)['"]@qandeel-company\/(?:storage|runtime|command-center|mind)/.test(code)) problems.push(`${f} reaches the Company store, runtime or surface (an adapter knows only its provider)`);
        if (/\btools\s*:/.test(code) || /stream:\s*true/.test(code)) problems.push(`${f} uses provider tools or streaming`);
      }
      const decl = read(L1_DECLARATION);
      if (decl !== undefined && !L1_THINKING_TABLE.test(decl)) problems.push(`${L1_DECLARATION}: the E1–E4 thinking table is not exactly none / low / high / max`);
      // The official wire shape: `thinking: { type }` plus a TOP-LEVEL `reasoning_effort` (allowlisted as a request
      // field); an effort nested inside `thinking` is silently ignored by the provider.
      if (decl !== undefined && !L1_EFFORT_ALLOWLISTED.test(decl)) problems.push(`${L1_DECLARATION}: reasoning_effort is not an allowlisted top-level request field`);
      const adapterCode = (read(L1_ADAPTER) ?? '').replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
      if (L1_EFFORT_NESTED.test(adapterCode)) problems.push(`${L1_ADAPTER} nests reasoning_effort inside thinking (the official contract carries it top-level)`);
      if (decl !== undefined && !/DEEPSEEK_MODEL_CODE = 'deepseek-flash'/.test(decl)) problems.push(`${L1_DECLARATION}: the model alias is not deepseek-flash`);
      for (const f of files.filter((x) => /^packages\/[^/]+\/src\//.test(x) && isCode(x))) {
        const code = (read(f) ?? '').replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
        if (L1_THINKING_FIELD.test(code)) problems.push(`${f} reads, returns or persists the provider's chain-of-thought field`);
      }
      const pricing = read(L1_PRICING);
      if (pricing !== undefined && !/basisSource: DEEPSEEK_PRICING_BASIS_SOURCE/.test(pricing)) problems.push(`${L1_PRICING} records no pricing basis source`);
      return problems;
    },
  },
  {
    id: 'l1-pricing-truthful',
    // D-L1-04: settlement records the actual provider bill (cache hits, band) while routing / reservation keep the
    // flat peak worst case; the datastore holds the schedule and identity gates; the confirmation catalogue carries the
    // provisioning intent.
    check: ({ files, read }) => {
      const problems = [];
      const core = read('packages/storage/src/governance-core.ts');
      if (core !== undefined && files.includes(L1_MIGRATION)) {
        if (!/actualCost\(card,/.test(core)) problems.push('packages/storage/src/governance-core.ts settles without the actual (cache-hit, banded) cost');
        if (!/cached_input_tokens, billing_band/.test(core)) problems.push('packages/storage/src/governance-core.ts records no cached input / billing band on the usage row');
      }
      const econ = read('packages/governance/src/economics.ts');
      if (econ !== undefined && files.includes(L1_MIGRATION)) {
        const worst = econ.split(/export function worstCase\b/)[1]?.split('\n}')[0] ?? '';
        if (!/costOf\(card, inputTokensUpperBound, maxOutputTokens\)/.test(worst) || /schedule|OFF_PEAK|cachedInputRate/.test(worst)) problems.push('packages/governance/src/economics.ts: worstCase must stay the flat peak, cache-miss cost (never a discount)');
        if (!/export function actualCost\b/.test(econ) || !/export function billingBandAt\b/.test(econ)) problems.push('packages/governance/src/economics.ts lacks the actual-cost / band functions');
      }
      const sql = read(L1_MIGRATION);
      if (sql !== undefined) {
        for (const tr of L1_GOVERNED_TRIGGERS) if (!new RegExp(`\\bCREATE\\s+TRIGGER\\s+${tr}\\b`).test(sql)) problems.push(`${L1_MIGRATION} lacks the datastore gate ${tr}`);
        if (!/'PROVIDER_PROVISION'\)\)/.test(sql)) problems.push(`${L1_MIGRATION} does not add PROVIDER_PROVISION to the confirmation catalogue`);
        if (SECRET_COLUMN.test(sql)) problems.push(`${L1_MIGRATION} declares a secret-shaped column`);
      }
      return problems;
    },
  },
  {
    id: 'ci-contract',
    // One stable required status; docs-only changes take a fast fail-closed path; every other change runs the
    // FULL proof set on Windows AND Ubuntu, split into parallel jobs whose mutation shards partition every
    // recorded mutation check exactly; post-merge and manual full runs exist; every action is SHA-pinned.
    check: ({ files, read }) => {
      const wf = read(CI_WORKFLOW);
      if (wf === undefined) return [`missing ${CI_WORKFLOW}`];
      const problems = [...yamlPlainScalarErrors(wf)];
      for (const need of [CI_CLASSIFIER, CI_GATE, CI_POST_MERGE, CI_IMPACT_MAP, CI_LOCAL_RUNNER]) if (!files.includes(need)) problems.push(`missing ${need}`);
      if (!/^\s+pull_request:\s*\n\s+branches:\s*\[main\]/m.test(wf) || !/^\s+push:\s*\n\s+branches:\s*\[main\]/m.test(wf) || !/^\s+workflow_dispatch:/m.test(wf)) problems.push('the workflow must run on pull_request / push to main and allow a manual (workflow_dispatch) full run');
      if (!/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(wf)) problems.push('the workflow default permissions must be contents: read');
      // A local reusable workflow of this repository (D1: ./.github/workflows/desktop.yml) is pinned by being in the tree.
      const unpinned = (text) => text.split('\n').filter((l) => /^\s*(?:-\s*)?uses:/.test(l) && !/uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}\b/.test(l) && !/uses:\s*\.\/\.github\/workflows\/[\w.-]+\.yml\s*$/.test(l));
      for (const line of unpinned(wf)) problems.push(`action not pinned to a commit SHA: ${line.trim()}`);
      // D1 (D-D1-07): the FULL path runs the Windows Desktop proof; the reusable workflow is read-only, SHA-pinned,
      // secret-free, Windows, and runs the Desktop proof, the real Setup end to end and the artifact verification.
      const desktopJob = ciJob(wf, 'desktop') ?? '';
      if (!/needs\.classify\.outputs\.mode == 'full'/.test(desktopJob) || !/uses:\s*\.\/\.github\/workflows\/desktop\.yml/.test(desktopJob)) problems.push('desktop must run .github/workflows/desktop.yml exactly on the full path');
      const dwf = read(CI_DESKTOP_WORKFLOW);
      if (dwf === undefined) problems.push(`missing ${CI_DESKTOP_WORKFLOW}`);
      else {
        for (const line of unpinned(dwf)) problems.push(`${CI_DESKTOP_WORKFLOW}: action not pinned to a commit SHA: ${line.trim()}`);
        if (!/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(dwf)) problems.push(`${CI_DESKTOP_WORKFLOW} default permissions must be contents: read`);
        if (/\$\{\{\s*secrets\./.test(dwf)) problems.push(`${CI_DESKTOP_WORKFLOW} uses a secret (no signing credential lives in CI)`);
        if (!/^\s+workflow_call:/m.test(dwf) || !/runs-on:\s*windows-latest/.test(dwf)) problems.push(`${CI_DESKTOP_WORKFLOW} must be a reusable Windows workflow`);
        for (const s of ['desktop:proof', 'desktop:e2e', 'desktop:verify']) if (!new RegExp(`npm run ${s}\\b`).test(dwf)) problems.push(`${CI_DESKTOP_WORKFLOW} does not run ${s}`);
        if (!/upload-artifact/.test(dwf)) problems.push(`${CI_DESKTOP_WORKFLOW} does not publish the verified Setup artifact`);
        problems.push(...yamlPlainScalarErrors(dwf).map((e) => `${CI_DESKTOP_WORKFLOW}: ${e}`));
      }
      for (const id of CI_JOBS) if (ciJob(wf, id) === undefined) problems.push(`the workflow has no ${id} job`);
      const gate = ciJob(wf, 'quality-gate') ?? '';
      if (!/^\s+if:\s*always\(\)\s*$/m.test(gate)) problems.push('quality-gate must run always() (a skipped or failed job fails the gate, never passes it)');
      for (const id of CI_JOBS.filter((x) => x !== 'quality-gate')) if (!new RegExp(`needs:\\s*\\[[^\\]]*\\b${id}\\b`).test(gate)) problems.push(`quality-gate does not need ${id}`);
      if (!/quality-gate\.mjs/.test(gate)) problems.push(`quality-gate does not run ${CI_GATE}`);
      const classify = ciJob(wf, 'classify') ?? '';
      if (!/classify-changes\.mjs --self-test/.test(classify)) problems.push('classify must run the classifier self-test');
      for (const t of ['impact-map', 'quality-gate', 'post-merge-mode']) if (!new RegExp(`${t}\\.mjs --self-test`).test(classify)) problems.push(`classify must run the ${t} self-test`);
      if (!/classify-changes\.mjs[^\n]*--plan-out/.test(classify) || !/name:\s*validation-plan/.test(classify)) problems.push('classify must publish the machine-readable validation plan');
      // D-D0-01: the affected path runs only on the affected mode, executes the canonical plan, and reports.
      for (const id of ['affected-checks', 'affected-mutation']) if (!/needs\.classify\.outputs\.mode == 'affected'/.test(ciJob(wf, id) ?? '')) problems.push(`${id} must run exactly on the affected path`);
      if (!/validate-affected\.mjs --execute-plan/.test(ciJob(wf, 'affected-checks') ?? '')) problems.push('affected-checks must execute the canonical plan (validate-affected.mjs --execute-plan)');
      if (!/--report/.test(ciJob(wf, 'affected-mutation') ?? '') || !/upload-artifact/.test(ciJob(wf, 'affected-mutation') ?? '')) problems.push('affected mutation shards must report the ids they ran (proof parity)');
      if (!/--plan\b/.test(gate) || !/--proofs\b/.test(gate)) problems.push('quality-gate must check the affected plan and proofs');
      if (!/--record-tested-tree/.test(gate)) problems.push('quality-gate must record the proven tree with its proof mode');
      if (!/post-merge-mode\.mjs/.test(classify)) problems.push('classify must decide the post-merge mode (fast integrity or full)');
      for (const id of ['static', 'tests', 'mutation', 'acceptance']) if (!/needs\.classify\.outputs\.mode == 'full'/.test(ciJob(wf, id) ?? '')) problems.push(`${id} must run exactly on the full path`);
      for (const id of CI_BOTH_OS_JOBS) {
        const job = ciJob(wf, id) ?? '';
        for (const os of CI_OPERATING_SYSTEMS) if (!job.includes(os)) problems.push(`${id} does not run on ${os}`);
      }
      const acceptance = ciJob(wf, 'acceptance') ?? '';
      for (const c of ['c1', 'c2', 'c3', 'c4', 'c5']) if (!new RegExp(`npm run ${c}:acceptance`).test(acceptance)) problems.push(`acceptance does not run ${c}:acceptance`);
      const tests = ciJob(wf, 'tests') ?? '';
      if (!/npm run test\b/.test(tests)) problems.push('tests must run every workspace test');
      const stat = ciJob(wf, 'static') ?? '';
      for (const s of ['build', 'typecheck', 'lint', 'verify']) if (!new RegExp(`npm run ${s}\\b`).test(stat)) problems.push(`static does not run ${s}`);
      // Mutation shards: per OS and script, the shard specs are exactly 1/n … n/n of one n.
      const mutation = ciJob(wf, 'mutation') ?? '';
      const entries = [...mutation.matchAll(/os:\s*([\w-]+),[^}]*suite:\s*'([^']+)'/g)].map((m) => ({ os: m[1], specs: m[2].split(/\s+/) }));
      for (const os of CI_OPERATING_SYSTEMS) {
        for (const script of Object.values(MUTATION_PINS).map((p) => p.script.split(':')[0])) {
          const shards = entries.filter((e) => e.os === os).flatMap((e) => e.specs).filter((s) => s.startsWith(`${script}:`)).map((s) => s.slice(script.length + 1));
          const ns = [...new Set(shards.map((s) => s.split('/')[1]))];
          const is = shards.map((s) => Number(s.split('/')[0])).sort((a, b) => a - b);
          const n = Number(ns[0]);
          if (shards.length === 0) problems.push(`${os} never runs ${script}:mutation`);
          else if (ns.length !== 1 || is.join() !== Array.from({ length: n }, (_, i) => i + 1).join()) problems.push(`${os} shards of ${script}:mutation (${shards.join(' ')}) are not exactly 1/n … n/n`);
        }
      }
      if (!/--report/.test(mutation) || !/upload-artifact/.test(mutation)) problems.push('mutation shards must report the ids they ran (proof parity)');
      return problems;
    },
  },
  {
    id: 'local-validation-proportional',
    // D0-I1 / D-D0-01: no normal local command launches the historical C1→L1 mutation universe. The root "ci"
    // script is the proportional runner (plan first, impacted boundary only); no root script chains two or more
    // mutation families (the serial universe may not survive under another name).
    check: ({ read }) => {
      const scripts = json(read('package.json'))?.scripts ?? {};
      const problems = [];
      const ci = String(scripts.ci ?? '');
      if (!/^node scripts\/ci\/validate-affected\.mjs\b/.test(ci)) problems.push('the root "ci" script must be the proportional runner (node scripts/ci/validate-affected.mjs)');
      if (!/^node scripts\/ci\/validate-affected\.mjs\b/.test(String(scripts['validate:affected'] ?? ''))) problems.push('the root "validate:affected" script must be node scripts/ci/validate-affected.mjs');
      for (const [name, cmd] of Object.entries(scripts)) {
        const fams = new Set([...String(cmd).matchAll(/\b([a-z0-9]+)(?::mutation\b|-mutation-check\.mjs)/g)].map((m) => m[1]));
        if (fams.size > 1) problems.push(`root script "${name}" chains ${fams.size} mutation families (the serial historical universe); FULL continuity proof belongs on GitHub`);
        if (name === 'ci' && fams.size > 0) problems.push('the root "ci" script runs a mutation family');
      }
      const runner = read(CI_LOCAL_RUNNER) ?? '';
      if (/-mutation-check\.mjs/.test(runner) || /MUTATION_FAMILIES/.test(runner)) problems.push(`${CI_LOCAL_RUNNER} can reach the historical mutation universe (only the plan's own families, opt-in)`);
      return problems;
    },
  },
  {
    id: 'ci-classifier-fails-closed',
    // The docs-only fast path is decided by a pure classifier that fails closed: an empty diff, any non-docs
    // path, or anything unexpected means the FULL proof set.
    check: ({ read }) => {
      const src = read(CI_CLASSIFIER);
      if (src === undefined) return [`missing ${CI_CLASSIFIER}`];
      const problems = [];
      for (const need of ["return 'full'", 'export function classify', 'SELF_TEST_CASES', "emit('full'"]) if (!src.includes(need)) problems.push(`${CI_CLASSIFIER} lost ${need}`);
      if (/return\s+'skip'|mode=skip/.test(src)) problems.push(`${CI_CLASSIFIER} can skip the proof set`);
      // D-D0-01: the canonical impact map fails closed — unknown, ambiguous, high-risk and malformed paths are FULL.
      const map = read(CI_IMPACT_MAP);
      if (map === undefined) problems.push(`missing ${CI_IMPACT_MAP}`);
      else {
        for (const need of ["class: 'full', rule: 'unknown-path'", "class: 'full', rule: 'malformed-path'", "class: 'full', rule: `ambiguous:", "class: 'full', rule: `high-risk:", 'export function auditRepo', 'SELF_TEST_CASES']) if (!map.includes(need)) problems.push(`${CI_IMPACT_MAP} lost ${need}`);
        if (/mode=skip|class:\s*'skip'/.test(map)) problems.push(`${CI_IMPACT_MAP} can skip the proof set`);
      }
      if (!/from '\.\/impact-map\.mjs'/.test(src)) problems.push(`${CI_CLASSIFIER} does not use the canonical impact map (one mapping, local and CI)`);
      if (!/from '\.\/impact-map\.mjs'/.test(read(CI_LOCAL_RUNNER) ?? '')) problems.push(`${CI_LOCAL_RUNNER} does not use the canonical impact map (one mapping, local and CI)`);
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
const REAL_TEXT = (p) => (existsSync(path.join(ROOT, p)) ? readFileSync(path.join(ROOT, p), 'utf8') : '');
const SYNTH_CI = { [CI_WORKFLOW]: REAL_TEXT(CI_WORKFLOW), [CI_DESKTOP_WORKFLOW]: REAL_TEXT(CI_DESKTOP_WORKFLOW), [CI_CLASSIFIER]: REAL_TEXT(CI_CLASSIFIER), [CI_GATE]: REAL_TEXT(CI_GATE), [CI_POST_MERGE]: REAL_TEXT(CI_POST_MERGE), [CI_IMPACT_MAP]: REAL_TEXT(CI_IMPACT_MAP), [CI_LOCAL_RUNNER]: REAL_TEXT(CI_LOCAL_RUNNER) };
// D1: the real Desktop distribution files (the desktop-distribution rule's legitimate state and its violations).
const SYNTH_DESKTOP = Object.fromEntries([DESKTOP_ISS, DESKTOP_PINS, DESKTOP_ICON_PROVENANCE, DESKTOP_MODULE, OPS_HOST_PROCESSES, ...DESKTOP_PROOFS].map((f) => [f, REAL_TEXT(f)]));
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
const SYNTH_LISTENER = "import { createServer } from 'node:http';\nimport { LOOPBACK_HOST } from '../security.js';\nthis.#server.listen({ host: LOOPBACK_HOST, port: this.#port, exclusive: true }, () => resolve());\n";
const SYNTH_AUTH = "import { founderSessionInternals } from './governance.js';\nctx.db.run('INSERT INTO founder_sessions (id, token_sha256, csrf_sha256, founder_ref, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', id, hash(cookieValue), hash(csrf), founderRef, at, expiresAt);\nrevokeAll(reasonCode) {}\n";
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

// C7-B: the release-created App Operations & Release Lead seat under the Product Director (its own LEAD seat).
const SYNTH_C7B_SEAT = "INSERT INTO org_positions (id, code, title, scope, department_id, kind) SELECT 'x', 'product.app-operations-release-lead', 'QANDEEL App Operations & Release Lead', 'DEPARTMENT', d.id, 'LEAD'\n  FROM departments d JOIN org_positions dir ON dir.code = 'director.product' AND dir.department_id = d.id;\n";

function syntheticRepo(overrides = {}) {
  const baseContents = {
    ...Object.fromEntries([...REQUIRED_FILES, ...REQUIRED_DOCS].map((f) => [f, ''])),
    [BASELINE]: SYNTH_BASELINE,
    [IMPLEMENTATION_MAP]: synthMap(),
    [AUTHORITY_INDEX]: `## Missing\n\n**${STAGE_16_MISSING}.**\n`,
    [AUTHORITY_MANIFEST]: synthManifest(manifestRow(SYNTH_SOURCE, SYNTH_SOURCE_TEXT)),
    [SYNTH_SOURCE]: SYNTH_SOURCE_TEXT,
    'package.json': JSON.stringify({ private: true, engines: { node: '>=24.11.0 <25.0.0' }, workspaces: ['packages/bootstrap-contract'], scripts: { ci: 'node scripts/ci/validate-affected.mjs', 'validate:affected': 'node scripts/ci/validate-affected.mjs', 'c1:mutation': 'node scripts/c1-mutation-check.mjs' } }),
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
    // C4: proofs and the pinned C4 mutation check.
    'packages/runtime/test/c4/proofs.test.ts': C4_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    [C4_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C4_MUTATION_CHECK].ids),
    // C5: proofs, the pinned C5 mutation check, the loopback listener, the auth store and a clean UI.
    'packages/runtime/test/c5/proofs.test.ts': C5_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    [C5_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C5_MUTATION_CHECK].ids),
    // C6: proofs, the pinned C6 mutation check, an encrypting resilience module and the external-outcomes seam.
    'packages/runtime/test/c6/proofs.test.ts': C6_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    [C6_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C6_MUTATION_CHECK].ids),
    [RESILIENCE_MODULE]: "const key = scryptSync(passphrase, salt, 32);\nconst c = createCipheriv('aes-256-gcm', key, iv);\nd.setAuthTag(tag);\n",
    [EVALUATION_KERNEL]: 'export interface ExternalOutcomeContext {\n  readonly governedSource: boolean;\n}\n',
    // C7-A: proofs, the pinned C7-A mutation check, the governed verification seam and the usable-evidence predicate.
    'packages/runtime/test/c7a/proofs.test.ts': C7A_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    [C7A_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C7A_MUTATION_CHECK].ids),
    // C7-B: the pinned C7-B mutation check (the control-plane rules apply where its modules exist). Released 0013 is
    // frozen (C7-C), so the base carries its real text and therefore the C7-B proofs it requires.
    [C7B_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C7B_MUTATION_CHECK].ids),
    'packages/runtime/test/c7b/proofs.test.ts': C7B_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    // C7-C: the pinned C7-C mutation check (the Pilot rules apply where its modules exist). Released 0014 is frozen
    // (C7-D), so the base carries its real text and therefore the C7-C proofs it requires.
    [C7C_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C7C_MUTATION_CHECK].ids),
    'packages/runtime/test/c7c/proofs.test.ts': C7C_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    'docs/C7B_CLOSURE_RECORD.md': '',
    // C7-D: the pinned C7-D mutation check (the workshop rules apply where its modules exist). Released 0015 is frozen
    // (L1-01), so the base carries its real text and therefore the C7-D proofs and the C7-C closure record it requires.
    [C7D_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[C7D_MUTATION_CHECK].ids),
    // L1-01: the pinned L1 mutation check (its rules apply where the L1 modules exist) and the C7-D closure record it needs.
    [L1_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[L1_MUTATION_CHECK].ids),
    // Released 0016 is frozen (L1-02), so the base carries its real text and therefore the L1 proofs it requires.
    'packages/secret-vault/test/proofs.test.ts': L1_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    'docs/C7D_CLOSURE_RECORD.md': '',
    'packages/runtime/test/c7d/proofs.test.ts': C7D_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'),
    'docs/C7C_CLOSURE_RECORD.md': '',
    [OUTCOME_CORE]: '  txAssertExternalEvidence(ctx, w.id, input.classes, input.refs);\n',
    [EXTERNAL_CORE]: C7A_USABLE_REASONS.map((r) => `  return '${r}';`).join('\n'),
    [FOUNDER_LISTENER]: SYNTH_LISTENER,
    'packages/command-center/src/security.ts': "export const LOOPBACK_HOST = '127.0.0.1';\nexport function sessionCookie(v) { return `${v}; HttpOnly; SameSite=Strict`; }\n",
    [FOUNDER_AUTH]: SYNTH_AUTH,
    'packages/command-center-ui/src/app/api.ts': "const res = await fetch(path, init);\n",
    'packages/command-center-ui/package.json': JSON.stringify({ private: true, scripts: { test: 'npm run build && node ../../scripts/run-node-tests.mjs' } }),
    [CONTEXT_ASSEMBLER]: SYNTH_ASSEMBLER,
    [MODEL_RUNTIME]: SYNTH_MODEL_RUNTIME,
    [RUNTIME_TYPES]: SYNTH_TYPES,
    [MEMORY_PROPOSALS]: 'const s = submitMemoryCandidate(store, fence, step, proposal);\n',
    [SKILL_LOADER]: "const t = loadVerified(ctx, 'skill_versions', id);\n",
    'packages/storage/src/memory.ts': "ctx.db.run('INSERT INTO memory_records (id) VALUES (?)', id);\nappendAudit(ctx, 'memory.corrected', 'memory', id, a, 'OK', null, { version: 2 });\n",
    'packages/mind/src/memory.ts': "import { QandeelError } from '@qandeel-company/domain';\nexport const decide = (content: string): string => content.trim();\n",
    [`${MIGRATIONS_DIR}0005_c3.sql`]: SYNTH_C3_SQL,
    ...SYNTH_CI,
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
  // L1-02.
  'l1-02-requires-l1-01-closure': [{ contents: { [L1_02_ACTIVATION]: 'export {};\n' }, remove: ['docs/L1_01_CLOSURE_RECORD.md'] }],
  'l1-02-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`L1\` | Local | Local | CLOSED / MERGED |\n` } },
    { contents: { [L1_02_REPORT]: '# Report\n\nL1-02 is CLOSED.\n' } },
  ],
  'l1-02-proofs-present': [{ contents: { [L1_02_ACTIVATION]: 'export {};\n' } }],
  'l1-02-benchmark-load-confined': [{ contents: { 'packages/storage/src/academy-packages.ts': 'const b = loadBenchmarkSkillInstructions(ctx, runId);\n' } }],
  'l1-02-activation-no-seam': [
    { contents: { [L1_02_ACTIVATION]: "import { activateEmployeeForTest } from '@qandeel-company/storage/testing';\n" } },
    { contents: { 'scripts/l1-02-activation-proof.mjs': "const { armFounderTestSurface } = await import('@qandeel-company/storage/testing');\n" } },
  ],
  'l1-02-activation-structured-only': [
    { contents: { [L1_02_ACTIVATION]: 'export {};\n', 'packages/governance/src/founder.ts': "function actOf(family, verb, obj) {\n  return { intent: 'EMPLOYEE_HIRE', decision: null };\n}\n" } },
  ],
  // L1-01.
  'l1-requires-c7d-closure': [{ contents: { [L1_VAULT]: 'export {};\n' }, remove: ['docs/C7D_CLOSURE_RECORD.md'] }],
  'l1-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`L1\` | Local | Local | CLOSED / MERGED |\n` } },
    { contents: { [L1_REPORT]: '# Report\n\nL1-01 is CLOSED.\n' } },
  ],
  'l1-proofs-present': [
    { contents: { [L1_VAULT]: 'export {};\n' }, remove: ['packages/secret-vault/test/proofs.test.ts'] },
    { contents: { [L1_VAULT]: 'export {};\n' }, remove: [L1_MUTATION_CHECK] },
  ],
  'l1-vault-protected': [
    { contents: { [L1_VAULT]: "import { execFile } from 'node:child_process';\nexecFile(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-EncodedCommand', x], { shell: false }); child.stdin.end(p); const dir = process.env.LOCALAPPDATA;\nconst plain = value; writeFileSync(file, plain);\n" } },
    { contents: { [L1_VAULT]: "import { exec } from 'node:child_process';\nexec(`powershell -Command ${cmd}`); // ProtectedData CurrentUser LOCALAPPDATA -EncodedCommand stdin shell: false\n" } },
    { contents: { [L1_VAULT]: "import { execFile } from 'node:child_process';\nimport { fetch } from 'undici';\nexecFile(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-EncodedCommand', x], { shell: false }); child.stdin.end(p); // ProtectedData CurrentUser LOCALAPPDATA\n" } },
    { contents: { [L1_VAULT_CLI]: "const secret = values.secret; // no FORBIDDEN_FLAGS, no raw mode\n" } },
    { contents: { 'packages/secret-vault/src/helper.ts': "import { spawn } from 'node:child_process';\n" } },
  ],
  // OPS.
  'founder-host-confined': [
    { contents: { [OPS_HOST_PROBE]: "import http from 'node:http';\nhttp.request({ host: '192.168.1.5', port, path: '/host/identity' });\n" } },
    { contents: { [OPS_HOST_PROBE]: "import http from 'node:http';\nhttp.request({ host: LOOPBACK_HOST, port, path: '/api/universe' });\n" } },
    { contents: { [OPS_HOST_PROBE]: "import http from 'node:http';\nimport { spawn } from 'node:child_process';\nhttp.request({ host: LOOPBACK_HOST, port });\n" } },
    { contents: { [OPS_HOST_PROCESSES]: "import { spawn } from 'node:child_process';\nspawn(userCommand, args, { shell: true });\n// path.join(SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') -EncodedCommand\n" } },
    { contents: { [OPS_HOST_PROCESSES]: "import { spawn } from 'node:child_process';\nimport http from 'node:http';\nspawn(process.execPath, args, { shell: false });\nconst ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); const a = ['-EncodedCommand'];\n" } },
    { contents: { [OPS_HOST_PROCESSES]: "import { exec } from 'node:child_process';\nexec(`powershell ${cmd}`); // shell: false\n" } },
    { contents: { [OPS_HOST_DESCRIPTOR]: "const { privateKey } = generateKeyPairSync('ed25519');\nconst pem = privateKey.export({ format: 'pem', type: 'pkcs8' });\nreadonly #privateKey: KeyObject;\n" } },
    { contents: { [OPS_HOST_LIFECYCLE]: "const { launchUrl } = mintLaunchUrl(ws, origin);\nconst opened = await openBrowser(launchUrl);\n" } },
    { contents: { [OPS_HOST_HANDOFF]: REAL_TEXT(OPS_HOST_HANDOFF).replace("header(req, 'sec-fetch-site') === 'none' &&", '') } },
    { contents: { [OPS_HOST_HANDOFF]: REAL_TEXT(OPS_HOST_HANDOFF).replace('server.listen(0, LOOPBACK_HOST,', "server.listen(0, '0.0.0.0',") } },
    { contents: { [OPS_HOST_HANDOFF]: REAL_TEXT(OPS_HOST_HANDOFF).replace('let location: string;', 'console.info(req.headers); let location: string;') } },
    // D-D2-01: the host gate's launch-page exception stays exactly a GET document navigation to /launch.
    { contents: { [OPS_SECURITY]: REAL_TEXT(OPS_SECURITY).replace(" && facts.secFetchMode === 'navigate'", '') } },
    { contents: { [OPS_SECURITY]: REAL_TEXT(OPS_SECURITY).replace('facts.path === LAUNCH_PAGE_PATH', 'facts.path?.startsWith(LAUNCH_PAGE_PATH) === true') } },
    { contents: { [OPS_SECURITY]: REAL_TEXT(OPS_SECURITY).replace("facts.method === 'GET' && ", '') } },
    { contents: { [OPS_SECURITY]: REAL_TEXT(OPS_SECURITY).replace("if (!MUTATING.has(facts.method)) return { ok: true };", "if (!MUTATING.has(facts.method) || isLaunchPageNavigation(facts)) return { ok: true };") } },
    // D-D2-01: the stopped-state desktop controller.
    { contents: { [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL).replace('listen({ host: LOOPBACK_HOST, port: 0,', "listen({ host: '0.0.0.0', port: 0,") } },
    { contents: { [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL).replace("if (facts.secFetchSite !== 'same-origin') return { ok: false", "if (facts.secFetchSite === 'cross-site') return { ok: false") } },
    { contents: { [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL).replace('facts.host.toLowerCase() !== `${LOOPBACK_HOST}:${port}`', '!allowedHosts(port).includes(facts.host.toLowerCase())') } },
    { contents: { [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL).replace("facts.origin.toLowerCase() !== origin) return { ok: false", "!facts.origin.startsWith('http://127.0.0.1')) return { ok: false") } },
    { contents: { [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL).replace('return timingSafeEqual(', 'return hashSecret(candidate) === hash || timingSafeEqual(').replace('randomBytes(32)', 'randomBytes(8)') } },
    { contents: { [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL).replace('const r = await stopHost(this.#o.workspace);', 'const r = await stopHost(this.#o.workspace, { force: true });') } },
    { contents: { [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL).replace("case `${DESKTOP_CONTROL_PATH}/enter`:", "case '/api/universe': case `${DESKTOP_CONTROL_PATH}/enter`:") } },
    { contents: { [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL).replace("const method = (req.method ?? 'GET').toUpperCase();", "const method = (req.method ?? 'GET').toUpperCase(); console.info(req.headers);") } },
    { contents: { [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL).replace("this.#log('desktop_control.redeemed', { intent: this.#intent });", "this.#log('desktop_control.redeemed', { intent: this.#intent, ticket });") } },
  ],
  'ops-proofs-present': [{ contents: { [OPS_HOST_PROBE]: 'export {};\n' } }],
  'ops-release-admission': [
    { contents: { [OPS_RELEASE_ADMISSION]: REAL_TEXT(OPS_RELEASE_ADMISSION), [OPS_RUNTIME]: "async start() {\n  const store = CompanyStore.open(this.#opts.workspace, {});\n  admitRuntimeRelease(this.#opts.workspace);\n}\n" } },
    { contents: { [OPS_RELEASE_ADMISSION]: REAL_TEXT(OPS_RELEASE_ADMISSION), [OPS_RUNTIME]: "async start() {\n  const store = CompanyStore.open(this.#opts.workspace, {});\n}\n" } },
    { contents: { [OPS_RELEASE_ADMISSION]: REAL_TEXT(OPS_RELEASE_ADMISSION).replace("if (self === null) return refuse('NOT_A_RELEASE'", "if (self === null) return { mode: 'UNPINNED', releaseId: null }; if (false) refuse('NOT_A_RELEASE'") } },
    { contents: { [OPS_RELEASE_ADMISSION]: REAL_TEXT(OPS_RELEASE_ADMISSION).replace("if (pin === undefined) return refuse('PIN_INVALID'", "if (pin === undefined) return { mode: 'UNPINNED', releaseId: null }; if (false) refuse('PIN_INVALID'") } },
    { contents: { [OPS_CLI]: 'const shortcuts = await installShortcuts(selfPath(), launcherConfigDir());\n' } },
    { contents: { [OPS_RELEASE]: REAL_TEXT(OPS_RELEASE).replace('backupBeforeActivation(workspace)', 'Promise.resolve({ result: "SKIPPED", backupId: null })') } },
  ],
  'l1-provider-boundary': [
    { contents: { [L1_TRANSPORT]: "const r = await fetch(`${process.env.PROVIDER_ORIGIN}${request.path}`, { redirect: 'error' });\nassertDeepSeekEndpoint(request.method, request.path);\n", [L1_DECLARATION]: "export const DEEPSEEK_API_ORIGIN = 'https://api.deepseek.com';\nexport const DEEPSEEK_MODEL_CODE = 'deepseek-flash';\nexport const DEEPSEEK_THINKING_BY_CLASS = Object.freeze({ E1: 'none', E2: 'low', E3: 'high', E4: 'max' });\n" } },
    { contents: { [L1_TRANSPORT]: "const r = await fetch(`${DEEPSEEK_API_ORIGIN}${request.path}`, { redirect: 'follow' });\nassertDeepSeekEndpoint(request.method, request.path);\n", [L1_DECLARATION]: "export const DEEPSEEK_API_ORIGIN = 'https://api.deepseek.com';\nexport const DEEPSEEK_MODEL_CODE = 'deepseek-flash';\nexport const DEEPSEEK_THINKING_BY_CLASS = Object.freeze({ E1: 'none', E2: 'low', E3: 'high', E4: 'max' });\n" } },
    { contents: { [L1_DECLARATION]: "export const DEEPSEEK_API_ORIGIN = 'https://api.deepseek.com';\nexport const DEEPSEEK_MODEL_CODE = 'deepseek-flash';\nexport const DEEPSEEK_THINKING_BY_CLASS = Object.freeze({ E1: 'none', E2: 'low', E3: 'high', E4: 'high' });\n" } },
    { contents: { [L1_ADAPTER]: "const out = { outputText: m.content, reasoning_content: m.reasoning_content };\n" } },
    { contents: { [L1_ADAPTER]: "const body = { model, messages, tools: [{ type: 'function' }] };\n" } },
    { contents: { [L1_ADAPTER]: "return effort === 'none' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled', reasoning_effort: effort } };\n" } },
    { contents: { [L1_DECLARATION]: "export const DEEPSEEK_API_ORIGIN = 'https://api.deepseek.com';\nexport const DEEPSEEK_MODEL_CODE = 'deepseek-flash';\nexport const DEEPSEEK_THINKING_BY_CLASS = Object.freeze({ E1: 'none', E2: 'low', E3: 'high', E4: 'max' });\nexport const DEEPSEEK_REQUEST_FIELDS = ['model', 'messages', 'max_tokens', 'stream', 'thinking', 'response_format'];\n" } },
    { contents: { 'packages/model-providers/src/deepseek/extra.ts': "const r = await fetch('https://other.example/v1');\n" } },
    { contents: { 'packages/model-providers/src/deepseek/extra.ts': "import { GovernanceStore } from '@qandeel-company/storage';\n" } },
    { contents: { 'packages/runtime/src/c2/leak.ts': "const cot = answer.reasoning_content;\n" } },
  ],
  'l1-pricing-truthful': [
    { contents: { [L1_MIGRATION]: L1_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n') + "\nCHECK (intent_kind IN ('PILOT_ADVANCE', 'PROVIDER_PROVISION'))\n", 'packages/storage/src/governance-core.ts': "const cost = costOf(card, usage.inputTokens, usage.outputTokens); // cached_input_tokens, billing_band\n" } },
    { contents: { [L1_MIGRATION]: L1_GOVERNED_TRIGGERS.slice(1).map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n') + "\nCHECK (intent_kind IN ('PILOT_ADVANCE', 'PROVIDER_PROVISION'))\n" } },
    { contents: { [L1_MIGRATION]: L1_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n') + "\nCHECK (intent_kind IN ('PILOT_ADVANCE'))\n" } },
    { contents: { [L1_MIGRATION]: L1_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n') + "\nCHECK (intent_kind IN ('PILOT_ADVANCE', 'PROVIDER_PROVISION'))\n", 'packages/governance/src/economics.ts': "export function worstCase(card, inputTokensUpperBound, maxOutputTokens) {\n  return actualCost(card, { inputTokens: inputTokensUpperBound, outputTokens: maxOutputTokens }, 'OFF_PEAK');\n}\nexport function actualCost() {}\nexport function billingBandAt() {}\n" } },
  ],
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
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace("- { os: windows-latest, label: c1-c2, suite: 'c1:1/1 c2:1/1' }\n", '') } },
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
    { contents: { [`${MIGRATIONS_DIR}0005_c3.sql`]: `${SYNTH_C3_SQL}CREATE TABLE employee_performance_scores (id TEXT) STRICT;\n` } },
    { contents: { [`${MIGRATIONS_DIR}0004_c2.sql`]: 'CREATE TABLE IF NOT EXISTS reporting_analytics_runs (id TEXT) STRICT;\n' } },
    { contents: { [`${MIGRATIONS_DIR}0004_c2.sql`]: 'CREATE TABLE kpi_dashboard_tiles (id TEXT) STRICT;\n' } },
    { contents: { [`${MIGRATIONS_DIR}0004_c2.sql`]: 'CREATE TABLE app_ops_incidents (id TEXT) STRICT;\n' } },
    { dirs: ['bootstrap-contract', 'dashboards'] },
    { dirs: ['bootstrap-contract', 'app-ops'] },
  ],
  'founder-listener-loopback-only': [
    { contents: { [FOUNDER_LISTENER]: SYNTH_LISTENER.replace('host: LOOPBACK_HOST', "host: '0.0.0.0'") } },
    { contents: { 'packages/command-center/src/api.ts': "import { createServer } from 'node:http';" } },
    { contents: { 'packages/command-center-ui/src/app/scene.ts': "const tex = loader.load('https://cdn.example.com/texture.png');" } },
    { contents: { 'packages/command-center-ui/public/index.html': '<script src="https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js"></script>' } },
    { contents: { 'packages/command-center-ui/src/app/main.ts': "import { readFileSync } from 'node:fs';" } },
  ],
  'c5-proofs-present': [
    { contents: { 'packages/runtime/test/c5/proofs.test.ts': '// markers removed\n' } },
    { remove: [C5_MUTATION_CHECK] },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace("- { os: windows-latest, label: c5-1of1, suite: 'c5:1/1' }\n", '') } },
  ],
  'c5-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS')}| \`C5\` | Founder | Cloud | CLOSED / MERGED |\n` } },
    { contents: { [C5_REPORT]: '# Report\n\nC5 — CLOSED.\n' } },
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS')}| \`C5\` | Founder | Cloud | IN PROGRESS |\n| \`C6\` | Reporting | Cloud | IN PROGRESS |\n` } },
  ],
  'founder-session-scope-confined': [
    { contents: { 'packages/command-center/src/api.ts': "founderSessionInternals.scope(root, () => gov.decideApproval(ref, id, input));" } },
    { contents: { 'packages/command-center/src/api.ts': "const founderRef = 'founder:unauthenticated';" } },
    { contents: { [FOUNDER_AUTH]: SYNTH_AUTH.replace('hash(cookieValue)', 'cookieValue') } },
    { contents: { 'packages/command-center/src/cli.ts': "switch (command) {\n  case 'approve':\n    break;\n}" } },
    { contents: { 'packages/command-center/src/server/listener.ts': `${SYNTH_LISTENER}ctx.db.run('UPDATE founder_sessions SET expires_at = ? WHERE id = ?', later, id);\n` } },
  ],
  'c5-telemetry-content-free': [
    { contents: { 'packages/storage/src/communications.ts': "appendAudit(ctx, 'communication.message', 'thread', t.id, { actorRef }, 'OK', m.purpose, { body: m.body });" } },
    { contents: { 'packages/command-center/src/api.ts': "this.#log('founder.command', { text: body.text });" } },
    { contents: { 'packages/storage/src/goals.ts': "appendEvent(ctx, 'goal.proposed', 'work_item', id, t, { title: input.title });" } },
  ],
  'c6-proofs-present': [
    { contents: { 'packages/runtime/test/c6/proofs.test.ts': '// markers removed\n' } },
    { remove: [C6_MUTATION_CHECK] },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace("- { os: ubuntu-latest, label: c6-1of1, suite: 'c6:1/1' }\n", '') } },
  ],
  'c6-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS')}| \`C6\` | Improve | Cloud | CLOSED / MERGED |\n` } },
    { contents: { [C6_REPORT]: '# Report\n\nC6 — CLOSED.\n' } },
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS')}| \`C6\` | Improve | Cloud | IN PROGRESS |\n| \`R2\` | Review | Review | IN PROGRESS |\n` } },
  ],
  'c6-no-universal-score': [
    { contents: { 'packages/mind/src/performance.ts': 'return { employeeId, overallScore: total / n, dimensions };' } },
    { contents: { [`${MIGRATIONS_DIR}0011_scores.sql`]: 'CREATE TABLE employee_profiles (id TEXT, performance_score INTEGER) STRICT;\n' } },
    { contents: { 'packages/storage/src/improvement.ts': 'const leaderboard = profiles.sort((a, b) => b.positive - a.positive);' } },
  ],
  'c6-telemetry-content-free': [
    { contents: { 'packages/storage/src/improvement.ts': "appendAudit(ctx, 'learning.classified', 'lesson', id, { actorRef }, 'OK', kind, { content: lesson.content });" } },
    { contents: { [RESILIENCE_MODULE]: "const key = scryptSync(passphrase, salt, 32);\ncreateCipheriv('aes-256-gcm', key, iv);\nd.setAuthTag(tag);\nappendAudit(ctx, 'backup.portable_created', 'portable_backup', id, a, 'OK', null, { passphrase: x });\n" } },
  ],
  'c6-recovery-secret-never-stored': [
    { contents: { [RESILIENCE_MODULE]: "const key = scryptSync(passphrase, salt, 32);\nconst c = createCipheriv('aes-256-ctr', key, iv);\n" } },
    { contents: { [RESILIENCE_MODULE]: "const key = scryptSync(passphrase, salt, 32);\ncreateCipheriv('aes-256-gcm', key, iv);\nd.setAuthTag(tag);\nwriteFileSync(path.join(dir, 'recovery.key'), passphrase);\n" } },
    { contents: { [CLI_SOURCE]: "const { values } = parseArgs({ args, options: { passphrase: { type: 'string' } } });" } },
  ],
  'external-outcomes-governed': [
    { contents: { [EVALUATION_KERNEL]: 'export const EXTERNAL_OUTCOMES_AVAILABLE = true;\n' } },
    { contents: { [OUTCOME_CORE]: 'export function txRecordOutcome(ctx, w, input) {\n  insert(ctx, w, input);\n}\n' } },
    { contents: { [EXTERNAL_CORE]: "  return 'NOT_OUTCOME_EVIDENCE';\n  return 'SOURCE_NOT_ACTIVE';\n  return 'RECORD_CONFLICTED';\n  return null;\n" } },
    // 0012 is frozen (C7-B): the synthetic base carries its real text, so the violation replaces that file itself.
    { contents: { [`${MIGRATIONS_DIR}0012_c7a_operational_data_external_outcomes.sql`]: 'CREATE TABLE external_records (id TEXT) STRICT;\nCREATE TRIGGER external_records_governed_source BEFORE INSERT ON external_records BEGIN SELECT 1; END;\n' } },
    { contents: { [IMPROVEMENT_CORE]:'export function gatherWorkEvidence(recorded) {\n  const verdict = recorded;\n  return verdict;\n}\n' } },
  ],
  'c7a-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-A\` | Core | Cloud | CLOSED / MERGED |\n` } },
    { contents: { [C7A_REPORT]: '# Report\n\nC7-A is CLOSED.\n' } },
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-A\` | Core | Cloud | IMPLEMENTATION CANDIDATE — NOT CLOSED |\n| \`C7-B\` | Control | Cloud | IN PROGRESS |\n` } },
  ],
  'c7a-proofs-present': [{ remove: ['packages/runtime/test/c7a/proofs.test.ts'] }, { remove: [C7A_MUTATION_CHECK] }],
  'c7a-intake-content-free': [
    { contents: { [EXTERNAL_STORE]: "appendAudit(ctx, 'external.intake_rejected', 'external_source', id, a, 'REJECTED', reason, { occurrence: JSON.stringify(raw).slice(0, 128) });" } },
    { contents: { [EXTERNAL_CORE]: "sourceEvent(ctx, 'external_record.accepted', id, a, { recordId, value: n.value });" } },
    { contents: { 'packages/storage/src/support.ts': 'export const lookup = (input: { userPseudonym: string }) => input.userPseudonym;\n' } },
    { contents: { [`${MIGRATIONS_DIR}0012_c7a.sql`]: 'CREATE TABLE external_records (\n  id TEXT NOT NULL,\n  raw_payload_json TEXT NOT NULL\n) STRICT;\n' } },
  ],
  'external-evidence-writes-confined': [
    { contents: { 'packages/storage/src/improvement.ts': "ctx.db.run('UPDATE external_sources SET state = ? WHERE id = ?', 'ACTIVE', id);" } },
    { contents: { [CLI_SOURCE]: 'const r = ExternalEvidenceStore.for(store).ingest(JSON.parse(text));\n' } },
  ],
  'c7a-extends-c6-only': [
    { contents: { [`${MIGRATIONS_DIR}0012_c7a.sql`]: 'CREATE TABLE external_evaluations (id TEXT) STRICT;\n' } },
    { contents: { [EXTERNAL_STORE]: "ctx.db.run('UPDATE work_items SET state = ? WHERE id = ?', 'OUTCOME_VERIFIED', id);" } },
  ],
  'c7-later-scope-not-leaked': [
    { contents: { 'packages/storage/src/app-control.ts': 'export function setKillSwitch(on: boolean): boolean {\n  return on;\n}\n' } },
    { contents: { [`${MIGRATIONS_DIR}0013_x.sql`]: 'CREATE TABLE feature_flags (id TEXT) STRICT;\n' } },
    { contents: { [C7B_STORE]: "export const pilotObjective = 'pilot_objective';\n" } },
  ],
  'c7b-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-B\` | Control | Cloud | CLOSED / MERGED |\n` }, remove: ['docs/C7B_CLOSURE_RECORD.md'] },
    { contents: { [C7B_REPORT]: '# Report\n\nC7-B is CLOSED.\n' }, remove: ['docs/C7B_CLOSURE_RECORD.md'] },
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-B\` | Control | Cloud | IMPLEMENTATION CANDIDATE — NOT CLOSED |\n| \`C7-C\` | Pilot | Cloud | IN PROGRESS |\n` }, remove: ['docs/C7B_CLOSURE_RECORD.md'] },
  ],
  'c7b-proofs-present': [
    { contents: { [C7B_KERNEL]: 'export {};\n' }, remove: ['packages/runtime/test/c7b/proofs.test.ts'] },
    { contents: { [C7B_KERNEL]: 'export {};\n', 'packages/runtime/test/c7b/proofs.test.ts': C7B_PROOF_MARKERS.map((m) => `// ${m}`).join('\n') }, remove: [C7B_MUTATION_CHECK] },
  ],
  'c7b-control-plane-governed': [
    { contents: { [C7B_KERNEL]: `export const CONTROL_FAMILIES = [${[...C7B_FAMILIES, 'REMOTE_EXECUTION'].map((f) => `'${f}'`).join(', ')}] as const;\nexport const PRODUCTION_REMOTE_CONFIG_FAMILIES: readonly RemoteConfigFamily[] = Object.freeze([]);\nexport const APP_CONTROL_RISK = 'R3';\n` } },
    { contents: { [C7B_KERNEL]: `export const CONTROL_FAMILIES = [${C7B_FAMILIES.map((f) => `'${f}'`).join(', ')}] as const;\nexport const PRODUCTION_REMOTE_CONFIG_FAMILIES: readonly RemoteConfigFamily[] = Object.freeze([{ code: 'demo' }]);\nexport const APP_CONTROL_RISK = 'R3';\n` } },
    { contents: { [C7B_KERNEL]: `export const CONTROL_FAMILIES = [${C7B_FAMILIES.map((f) => `'${f}'`).join(', ')}] as const;\nexport const PRODUCTION_REMOTE_CONFIG_FAMILIES: readonly RemoteConfigFamily[] = Object.freeze([]);\nexport const APP_CONTROL_RISK = 'R1';\n` } },
    { contents: { [C7B_MIGRATION]: 'CREATE TABLE app_control_revisions (id TEXT) STRICT;\nCREATE TRIGGER app_control_revisions_sequence BEFORE INSERT ON x BEGIN SELECT 1; END;\n' } },
    { contents: { [`${MIGRATIONS_DIR}0014_x.sql`]: "INSERT INTO app_remote_config_families (code) VALUES ('max-retries');\n", [C7B_MIGRATION]: `CREATE TABLE app_control_revisions (\n  company_state      TEXT    NOT NULL CHECK (company_state = 'ISSUED')\n) STRICT;\n  family            TEXT    NOT NULL PRIMARY KEY CHECK (family IN (${C7B_FAMILIES.map((f) => `'${f}'`).join(', ')})),\n${C7B_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n')}\n` } },
    { contents: { [C7B_STORE]: "ctx.db.run(`INSERT INTO app_control_revisions (id, company_state) VALUES (?, 'APPLIED')`, id);\n" } },
    { contents: { [C7B_STORE]: 'export {};\n', 'packages/storage/src/improvement.ts': "ctx.db.run('UPDATE app_control_proposals SET state = ? WHERE id = ?', 'ISSUED', id);" } },
    { contents: { [C7B_STORE]: 'export {};\n', [CLI_SOURCE]: 'txControlApprovalDecided(ctx, a, "APPROVED", founder);\n' } },
  ],
  'c7b-no-generic-execution': [
    { contents: { [C7B_STORE]: 'export const run = (code: string): unknown => eval(code);\n' } },
    { contents: { [C7B_KERNEL]: "import { execFile } from 'node:child_process';\n" } },
    { contents: { [C7B_MIGRATION]: 'CREATE TABLE app_control_keys (\n  id TEXT NOT NULL,\n  signing_key TEXT NOT NULL\n) STRICT;\n' } },
  ],
  'c7b-roles-separate': [
    { contents: { [C7B_MIGRATION]: "UPDATE org_positions SET title = 'App Store & Operations Lead' WHERE code = 'product.app-store-release-reputation-lead';\n" } },
    { contents: { [C7B_MIGRATION]: `${SYNTH_C7B_SEAT}INSERT INTO position_assignments (id) VALUES ('x');\n` } },
  ],
  'c7b-intake-refusals-bounded': [
    { contents: { [EXTERNAL_STORE]: "appendAudit(ctx, 'external.intake_rejected', 'external_source', id, a, 'REJECTED', reason, {});\n", [C7B_MIGRATION]: 'CREATE TRIGGER external_intake_refusal_windows_bounded_key BEFORE INSERT ON x BEGIN SELECT 1; END;\n' } },
  ],
  'c7c-requires-c7b-closure': [
    { contents: { [C7C_STORE]: 'export {};\n' }, remove: ['docs/C7B_CLOSURE_RECORD.md'] },
  ],
  'c7c-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-C\` | Pilot | Cloud | CLOSED / MERGED |\n` }, remove: ['docs/C7C_CLOSURE_RECORD.md'] },
    { contents: { [C7C_REPORT]: '# Report\n\nC7-C is CLOSED.\n' }, remove: ['docs/C7C_CLOSURE_RECORD.md'] },
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-C\` | Pilot | Cloud | IMPLEMENTATION CANDIDATE — NOT CLOSED |\n| \`C7-D\` | Digital | Cloud | IN PROGRESS |\n` }, remove: ['docs/C7C_CLOSURE_RECORD.md'] },
  ],
  'c7c-proofs-present': [
    { contents: { [C7C_STORE]: 'export {};\n' }, remove: ['packages/runtime/test/c7c/proofs.test.ts'] },
    { contents: { [C7C_STORE]: 'export {};\n', 'packages/runtime/test/c7c/proofs.test.ts': C7C_PROOF_MARKERS.map((m) => `// ${m}`).join('\n') }, remove: [C7C_MUTATION_CHECK] },
  ],
  'c7c-pilot-governed': [
    { contents: { [C7C_MIGRATION]: 'CREATE TABLE pilots (\n  id TEXT NOT NULL\n) STRICT;\nCREATE TRIGGER pilots_forward BEFORE UPDATE ON pilots BEGIN SELECT 1; END;\n' } },
    { contents: { [C7C_MIGRATION]: `CREATE TABLE pilot_scores (\n  id TEXT NOT NULL\n) STRICT;\n${C7C_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n')}\n` } },
    { contents: { [C7C_MIGRATION]: `CREATE TABLE pilots (\n  id TEXT NOT NULL,\n  transcript_text TEXT NOT NULL\n) STRICT;\n${C7C_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n')}\n` } },
    { contents: { 'packages/storage/src/goals.ts': "ctx.db.run(`UPDATE pilots SET state = 'ACTIVE' WHERE id = ?`, id);\n" } },
    { contents: { [CLI_SOURCE]: 'txAdvancePilot(ctx, id, { to: "READY" }, founder);\n' } },
    { contents: { [C7C_EVIDENCE]: "export const READINESS_CRITERIA = ['FOUNDER_DIALOGUE'] as const;\nexport const AUTONOMY_DIMENSIONS: readonly PerformanceDimension[] = ['JUDGMENT', 'INDEPENDENCE'];\n" } },
    { contents: { [C7C_EVIDENCE]: "export const READINESS_CRITERIA = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;\nexport const AUTONOMY_DIMENSIONS: readonly PerformanceDimension[] = ['AUTONOMY'];\n" } },
  ],
  'c7c-no-c7d-or-network': [
    { contents: { [C7C_STORE]: "const r = await fetch('https://example.com/x');\n" } },
    { contents: { [C7C_STORE]: 'export function publishLandingPage(): void {}\n' } },
    { contents: { [C7C_EVIDENCE]: 'export const controlState = APPLIED;\n' } },
  ],
  // C7-D: started before C7-C closed, claimed closed / built, proofs missing, gates missing, a content column, a second
  // table, writes outside the store, a success claim, driver boundary breaches, preview isolation breaches, a vendor.
  'c7d-requires-c7c-closure': [
    { contents: { [C7D_STORE]: 'export {};\n' }, remove: ['docs/C7C_CLOSURE_RECORD.md'] },
    { contents: { 'packages/tool-drivers/src/index.ts': 'export {};\n' }, remove: ['docs/C7C_CLOSURE_RECORD.md'] },
  ],
  'c7d-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-D\` | Digital | Cloud | CLOSED / MERGED |\n` }, remove: ['docs/C7D_CLOSURE_RECORD.md'] },
    { contents: { [C7D_REPORT]: '# Report\n\nC7-D is CLOSED.\n' }, remove: ['docs/C7D_CLOSURE_RECORD.md'] },
    { contents: { [C7D_REPORT]: '# Report\n\nThe QANDEEL website is built and live.\n' } },
    { contents: { [C7D_REPORT]: '# Report\n\nWe selected Vercel for hosting.\n' } },
  ],
  'c7d-proofs-present': [
    { contents: { [C7D_STORE]: 'export {};\n' }, remove: ['packages/runtime/test/c7d/proofs.test.ts'] },
    { contents: { [C7D_STORE]: 'export {};\n' }, remove: [C7D_MUTATION_CHECK] },
  ],
  'c7d-digital-governed': [
    { contents: { [C7D_MIGRATION]: 'CREATE TABLE digital_projects (\n  id TEXT NOT NULL\n) STRICT;\n' } },
    { contents: { [C7D_MIGRATION]: `CREATE TABLE digital_files (\n  file_content TEXT NOT NULL\n) STRICT;\n${C7D_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n')}\n` } },
    { contents: { [C7D_MIGRATION]: `CREATE TABLE digital_revisions (\n  id TEXT NOT NULL,\n  approval_state TEXT NOT NULL\n) STRICT;\n${C7D_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n')}\n` } },
    { contents: { 'packages/runtime/src/digital-hack.ts': "ctx.db.run('UPDATE digital_revisions SET state = ? WHERE id = ?', s, id);\n" } },
    { contents: { [C7D_STORE]: "ctx.db.run('UPDATE approvals SET state = ? WHERE id = ?', s, id);\n" } },
    { contents: { [C7D_STORE]: 'export const view = { countsAsMarketOutcome: true };\n' } },
  ],
  'c7d-tool-boundary': [
    { contents: { 'packages/tool-drivers/src/x.ts': "import { CompanyStore } from '@qandeel-company/storage';\n" } },
    { contents: { 'packages/tool-drivers/src/y.ts': "const r = await fetch('https://api.vendor.example/v1');\n" } },
    { contents: { 'packages/tool-drivers/src/w.ts': 'send({ ref: x, force: true });\n' } },
    { contents: { [C7D_TRANSPORT]: "const GITHUB_API_ORIGIN = 'https://api.github.com';\nconst other = 'https://evil.example';\nredirect: 'error';\nassertGitHubEndpoint(request.method, request.path);\n" } },
    { contents: { [C7D_TRANSPORT]: "const GITHUB_API_ORIGIN = 'https://api.github.com';\nredirect: 'follow';\nassertGitHubEndpoint(request.method, request.path);\n" } },
    { contents: { [C7D_GITHUB_DECLARATION]: "export const GITHUB_TOKEN_PERMISSIONS: Readonly<Record<string, string>> = Object.freeze({ contents: 'write', administration: 'read' });\n" } },
    { contents: { [C7D_GITHUB_ENDPOINTS]: "const ALLOWED = [\n  { method: 'DELETE', re: /x/, mutates: true },\n];\n" } },
    { contents: { [C7D_GITHUB_ENDPOINTS]: "const ALLOWED = [\n  { method: 'PUT', re: /branches\\/main\\/protection/, mutates: true },\n];\n" } },
    { contents: { 'packages/runtime/src/z.ts': "const d = 'company.digital-workspace';\n" } },
  ],
  'c7d-preview-isolated': [
    { contents: { [C7D_PREVIEW]: "export const PREVIEW_HOST = '127.0.0.1';\nserver.listen({ host: PREVIEW_HOST });\n" } },
    { contents: { [C7D_PREVIEW]: "export const PREVIEW_HOST = '127.0.0.2';\nserver.listen({ host: PREVIEW_HOST });\nconst csp = \"sandbox allow-scripts allow-same-origin; connect-src 'none'; form-action 'none'; worker-src 'none'\"; const robots = 'noindex';\n" } },
    { contents: { [C7D_PREVIEW]: "export const PREVIEW_HOST = '127.0.0.2';\nserver.listen({ host: PREVIEW_HOST });\nconst csp = \"sandbox allow-scripts; form-action 'none'; worker-src 'none'\"; const robots = 'noindex';\n" } },
    { contents: { [C7D_PREVIEW]: "export const PREVIEW_HOST = '127.0.0.2';\nserver.listen({ host: PREVIEW_HOST });\nconst csp = \"sandbox allow-scripts; connect-src 'none'; form-action 'none'; worker-src 'none'\"; const robots = 'noindex';\nres.setHeader('Set-Cookie', c);\n" } },
  ],
  'c7d-no-vendor-preselection': [
    { contents: { [C7D_STORE]: "export const HOSTING = 'vercel';\n" } },
    { contents: { 'packages/tool-drivers/src/social/linkedin.ts': "export const VERSION = 'linkedin-202609';\n" } },
  ],
  'ci-contract': [    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace("- { os: windows-latest, label: r1-4of4, suite: 'r1:4/4' }\n", '') } },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace(/- \{ os: ubuntu-latest, label: c4-c5, suite: 'c4:1\/1 c5:1\/1' \}\n/, '') } },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace('desktop]\n    if: always()\n', 'desktop]\n    if: success()\n') } },
    // D1: the Desktop proof dropped from the FULL path, or the reusable workflow weakened.
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace('uses: ./.github/workflows/desktop.yml', 'uses: ./.github/workflows/other.yml') } },
    { contents: { [CI_DESKTOP_WORKFLOW]: SYNTH_CI[CI_DESKTOP_WORKFLOW].replace('npm run desktop:e2e', 'echo skipped') } },
    { contents: { [CI_DESKTOP_WORKFLOW]: SYNTH_CI[CI_DESKTOP_WORKFLOW].replace('    timeout-minutes: 75\n', '    timeout-minutes: 75\n    env:\n      KEY: ${{ secrets.SIGNING_KEY }}\n') } },
    { remove: [CI_DESKTOP_WORKFLOW] },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', 'actions/checkout@v7') } },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace(/os: \[windows-latest, ubuntu-latest\]/g, 'os: [ubuntu-latest]') } },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace('  workflow_dispatch:\n', '') } },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace('npm run c4:acceptance', 'echo c4') } },
    // The C4 run 36484710639 defect: an unquoted step name with ': ' — the workflow does not parse.
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace('name: Upload the validation plan (machine-readable, names its mode)', 'name: Upload the validation plan: machine-readable') } },
    // D-D0-01: the affected path widened beyond its mode, its plan executor dropped, or the map self-test dropped.
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace("if: needs.classify.outputs.mode == 'affected' && needs.classify.outputs.mutation_matrix != '[]'", "if: needs.classify.outputs.mutation_matrix != '[]'") } },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace('node scripts/ci/validate-affected.mjs --execute-plan', 'npm run test #') } },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace('node scripts/ci/impact-map.mjs --self-test', 'true') } },
    { remove: [CI_IMPACT_MAP] },
    { remove: [CI_GATE] },
  ],
  'desktop-distribution': [
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_ISS]: SYNTH_DESKTOP[DESKTOP_ISS].replace('PrivilegesRequired=lowest', 'PrivilegesRequired=admin') } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_ISS]: SYNTH_DESKTOP[DESKTOP_ISS].replace('ChangesEnvironment=no', 'ChangesEnvironment=yes') } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_ISS]: `${SYNTH_DESKTOP[DESKTOP_ISS]}\n[Registry]\nRoot: HKCU; Subkey: "Software\\Microsoft\\Windows\\CurrentVersion\\Run"; ValueName: "QANDEEL"\n` } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_ISS]: `${SYNTH_DESKTOP[DESKTOP_ISS]}\n[UninstallDelete]\nType: filesandordirs; Name: "{localappdata}\\QANDEEL_COMPANY"\n` } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_ISS]: SYNTH_DESKTOP[DESKTOP_ISS].replace('DestDir: "{app}\\versions\\{#VersionDir}"', 'DestDir: "{app}"') } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_PINS]: SYNTH_DESKTOP[DESKTOP_PINS].replace('"arch": "x64"', '"arch": "arm64"') } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_PINS]: SYNTH_DESKTOP[DESKTOP_PINS].replace(/"sha256": "3602f2bb[0-9a-f]+"/, '"sha256": null') } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_ICON_PROVENANCE]: SYNTH_DESKTOP[DESKTOP_ICON_PROVENANCE].replace(DESKTOP_ICON_SOURCE_SHA256, '0'.repeat(64)) } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_MODULE]: SYNTH_DESKTOP[DESKTOP_MODULE].replace('  const bundle = verifyDesktopBundle(bundleDir);', '  const bundle = { ok: true, manifest: null };') } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_MODULE]: `${SYNTH_DESKTOP[DESKTOP_MODULE]}\nexport function fresh(ws: string) { CompanyStore.open(ws).close(); }\n` } },
    { contents: { ...SYNTH_DESKTOP, [DESKTOP_MODULE]: `${SYNTH_DESKTOP[DESKTOP_MODULE]}\nexport function wipe(ws: string) { rmSync(ws, { recursive: true }); }\n` } },
    { contents: { ...SYNTH_DESKTOP, 'packaging/windows/dist/QANDEEL-COMPANY-Setup.exe': 'MZ' } },
    { contents: { ...SYNTH_DESKTOP, [OPS_HOST_PROCESSES]: SYNTH_DESKTOP[OPS_HOST_PROCESSES].replace('if (!isProductProgramDir(programDir) || !userKey(key)) return null;', '') } },
  ],
  'local-validation-proportional': [
    { contents: { 'package.json': JSON.stringify({ private: true, scripts: { ci: 'npm run build && npm run c1:mutation && npm run c2:mutation && npm run verify', 'validate:affected': 'node scripts/ci/validate-affected.mjs' } }) } },
    { contents: { 'package.json': JSON.stringify({ private: true, scripts: { ci: 'node scripts/ci/validate-affected.mjs', 'validate:affected': 'node scripts/ci/validate-affected.mjs', 'ci:everything': 'npm run c1:mutation && npm run c2:mutation && npm run l1:mutation' } }) } },
    { contents: { 'package.json': JSON.stringify({ private: true, scripts: { ci: 'node scripts/ci/validate-affected.mjs && npm run c5:mutation', 'validate:affected': 'node scripts/ci/validate-affected.mjs' } }) } },
    { contents: { 'package.json': JSON.stringify({ private: true, scripts: { ci: 'echo ok', 'validate:affected': 'node scripts/ci/validate-affected.mjs' } }) } },
    { contents: { [CI_LOCAL_RUNNER]: `${SYNTH_CI[CI_LOCAL_RUNNER]}\nfor (const f of MUTATION_FAMILIES) run(f);\n` } },
  ],
  'ci-classifier-fails-closed': [
    { contents: { [CI_CLASSIFIER]: SYNTH_CI[CI_CLASSIFIER].replace("if (!Array.isArray(files) || files.length === 0) return 'full';", "if (!Array.isArray(files) || files.length === 0) return 'skip';") } },
    { remove: [CI_CLASSIFIER] },
    { contents: { [CI_IMPACT_MAP]: SYNTH_CI[CI_IMPACT_MAP].replace("return { file, class: 'full', rule: 'unknown-path' };", "return { file, class: 'affected', rule: 'unknown-path' };") } },
    { contents: { [CI_LOCAL_RUNNER]: SYNTH_CI[CI_LOCAL_RUNNER].replace("from './impact-map.mjs'", "from './my-own-map.mjs'") } },
  ],
  'c4-proofs-present': [
    { contents: { 'packages/runtime/test/c4/proofs.test.ts': '// markers removed\n' } },
    { remove: [C4_MUTATION_CHECK] },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace("- { os: ubuntu-latest, label: c4-c5, suite: 'c4:1/1 c5:1/1' }\n", '') } },
  ],
  'c4-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS')}` } },
    { contents: { [C4_REPORT]: '# Report\n\nC4 — CLOSED.\n' } },
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'IN PROGRESS')}| \`C5\` | Founder | Cloud | IN PROGRESS |\n` } },
  ],
  'organization-writes-confined': [
    { contents: { 'packages/storage/src/store.ts': "ctx.db.run('UPDATE position_assignments SET status = ? WHERE id = ?', s, id);" } },
    { contents: { 'packages/runtime/src/c2/employee-task.ts': 'rt.org.organization.assignPrimary(founder, input);' } },
    { contents: { 'packages/runtime/src/runtime.ts': `${SYNTH_RUNTIME}store.review.resolveConflict(founder, id, 'PASS', 'x');\n` } },
    { contents: { 'packages/storage/src/index.ts': "export { txOrgAct } from './org-writes.js';\n" } },
  ],
  'c4-telemetry-content-free': [
    { contents: { 'packages/storage/src/review-core.ts': "appendAudit(ctx, 'review.decided', 'review_decision', id, a, 'OK', null, { rationale: d.rationale });" } },
    { contents: { 'packages/storage/src/org-writes.ts': "appendEvent(ctx, 'org.handoff', 'work_delegation', id, t, { body, kind });" } },
    { contents: { 'packages/storage/src/organization.ts': "appendAudit(ctx, 'org.staffing', 'staffing_request', id, a, 'OK', null, { businessNeed: r.businessNeed });" } },
  ],
  'r4-never-review-satisfied': [
    { contents: { [`${MIGRATIONS_DIR}0008_c4.sql`]: "CREATE TABLE review_requests (id TEXT, risk_level TEXT, state TEXT) STRICT;\n" } },
    { contents: { [AUTHORITY_KERNEL]: "export function decideEmployeeAction() { return { effect: 'ALLOW' }; }\n" } },
  ],
  'review-pool-not-department': [
    { contents: { [`${MIGRATIONS_DIR}0007_c4.sql`]: "INSERT INTO departments (id, code, name) SELECT 'c4d00000-0000-4000-8000-000000000009', 'review-pool', 'Review Pool' WHERE 1;\n" } },
    { contents: { [`${MIGRATIONS_DIR}0007_c4.sql`]: ['strategic-market-intelligence', 'growth', 'brand-creative', 'product'].map((c, i) => `INSERT INTO departments (id, code, name) SELECT 'c4d00000-0000-4000-8000-00000000000${i + 1}', '${c}', 'x' WHERE 1;\n`).join('') } },
  ],
  'c2-proofs-present': [
    { contents: { 'packages/runtime/test/c2/proofs.test.ts': '// markers removed\n' } },
    { remove: [C2_MUTATION_CHECK] },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace("- { os: windows-latest, label: c1-c2, suite: 'c1:1/1 c2:1/1' }\n", '') } },
  ],
  'c2-not-claimed-closed': [
    { contents: { [IMPLEMENTATION_MAP]: synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS') } },
    { contents: { [C2_REPORT]: '# Report\n\nC2 — CLOSED.\n' } },
    { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'IN PROGRESS')}| \`C3\` | Mem | Cloud | IN PROGRESS |\n` } },
  ],
  'c3-proofs-present': [
    { contents: { 'packages/runtime/test/c3/proofs.test.ts': '// markers removed\n' } },
    { remove: [C3_MUTATION_CHECK] },
    { contents: { [CI_WORKFLOW]: SYNTH_CI[CI_WORKFLOW].replace("- { os: ubuntu-latest, label: c3-1of1, suite: 'c3:1/1' }\n", '') } },
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
    // The synthetic repository carries the real (frozen) 0006 and 0007, which hold the gate: drop them as well.
    { contents: { [`${MIGRATIONS_DIR}0005_c3.sql`]: 'CREATE TABLE memory_records (id TEXT) STRICT;\n' }, remove: [`${MIGRATIONS_DIR}0006_c3_skills_academy.sql`, `${MIGRATIONS_DIR}0007_c4_organization.sql`] },
    { contents: { 'packages/storage/src/academy.ts': "setEmployeeState(ctx, e, 'ACTIVE', 'CERTIFIED', ref, [`test-seam:${id}`]);" } },
  ],
  'local-core-longpaths': { longpaths: undefined },
};

// Legitimate future states that each rule must accept (stage-awareness, not a frozen snapshot).
const MUST_PASS = [
  // L1-02 legitimate states: a candidate explicitly not closed with L1-01 closed; the loader in its two modules; proofs present.
  { id: 'l1-02-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`L1\` | Local | Local | IN PROGRESS — L1-01 CLOSED / MERGED / CANONICAL; L1-02 implementation candidate; not closed |\n`, [L1_02_REPORT]: '# Report\n\nL1-02 is NOT CLOSED (implementation candidate).\n' } } },
  { id: 'l1-02-benchmark-load-confined', scenario: { contents: { 'packages/storage/src/mind-writes.ts': 'const b = loadBenchmarkSkillInstructions(ctx, fence.runId);\n', 'packages/storage/src/mind-core.ts': 'export function loadBenchmarkSkillInstructions() { return null; }\n' } } },
  { id: 'l1-02-proofs-present', scenario: { contents: { [L1_02_ACTIVATION]: 'export {};\n', 'packages/runtime/test/l1/l1-02.test.ts': L1_02_PROOF_MARKERS.map((m) => `// ${m}`).join('\n') } } },
  { id: 'l1-02-requires-l1-01-closure', scenario: { contents: { [L1_02_ACTIVATION]: 'export {};\n', 'docs/L1_01_CLOSURE_RECORD.md': '' } } },
  // L1-01 legitimate states: a candidate explicitly not closed; the real vault, transport, declaration, adapter and
  // migration (comments may name the chain-of-thought field and the pricing-docs host); an adapter test calling generate.
  { id: 'l1-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`L1\` | Local | Local | IN PROGRESS — L1-01 implementation candidate; not closed |\n`, [L1_REPORT]: '# Report\n\nL1-01 is NOT CLOSED (implementation candidate).\n' } } },
  { id: 'l1-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`L1\` | Local | Local | CLOSED / MERGED / CANONICAL |\n`, 'docs/L1_01_CLOSURE_RECORD.md': '' } } },
  // OPS legitimate states: the real host modules; proofs present.
  { id: 'founder-host-confined', scenario: { contents: { [OPS_HOST_PROBE]: REAL_TEXT(OPS_HOST_PROBE), [OPS_HOST_PROCESSES]: REAL_TEXT(OPS_HOST_PROCESSES), [OPS_HOST_DESCRIPTOR]: REAL_TEXT(OPS_HOST_DESCRIPTOR), [OPS_HOST_HANDOFF]: REAL_TEXT(OPS_HOST_HANDOFF), [OPS_HOST_LIFECYCLE]: REAL_TEXT(OPS_HOST_LIFECYCLE), [OPS_DESKTOP_CONTROL]: REAL_TEXT(OPS_DESKTOP_CONTROL), [OPS_SECURITY]: REAL_TEXT(OPS_SECURITY) } } },
  { id: 'ops-release-admission', scenario: { contents: { [OPS_RUNTIME]: REAL_TEXT(OPS_RUNTIME), [OPS_RELEASE_ADMISSION]: REAL_TEXT(OPS_RELEASE_ADMISSION), [OPS_RELEASE]: REAL_TEXT(OPS_RELEASE), [OPS_CLI]: REAL_TEXT(OPS_CLI) } } },
  { id: 'desktop-distribution', scenario: { contents: SYNTH_DESKTOP } },
  { id: 'ops-proofs-present', scenario: { contents: { [OPS_HOST_PROBE]: 'export {};\n', 'packages/command-center/test/host.test.ts': OPS_PROOF_MARKERS.map((m) => `// ${m}`).join('\n') } } },
  { id: 'l1-vault-protected', scenario: { contents: { [L1_VAULT]: REAL_TEXT(L1_VAULT), [L1_VAULT_CLI]: REAL_TEXT(L1_VAULT_CLI), 'packages/secret-vault/src/vault.ts': REAL_TEXT('packages/secret-vault/src/vault.ts') } } },
  { id: 'l1-provider-boundary', scenario: { contents: { [L1_TRANSPORT]: REAL_TEXT(L1_TRANSPORT), [L1_DECLARATION]: REAL_TEXT(L1_DECLARATION), [L1_ADAPTER]: REAL_TEXT(L1_ADAPTER), [L1_PRICING]: REAL_TEXT(L1_PRICING), 'packages/model-providers/src/deepseek/transport.ts': REAL_TEXT('packages/model-providers/src/deepseek/transport.ts'), 'packages/model-providers/test/x.test.ts': 'await adapter.generate(req, signal);\n' } } },
  { id: 'l1-pricing-truthful', scenario: { contents: { [L1_MIGRATION]: REAL_TEXT(L1_MIGRATION), 'packages/storage/src/governance-core.ts': REAL_TEXT('packages/storage/src/governance-core.ts'), 'packages/governance/src/economics.ts': REAL_TEXT('packages/governance/src/economics.ts') } } },
  { id: 'l1-requires-c7d-closure', scenario: { contents: { [L1_VAULT]: 'export {};\n', 'docs/C7D_CLOSURE_RECORD.md': '' } } },
  { id: 'l1-proofs-present', scenario: { contents: { [L1_VAULT]: 'export {};\n', 'packages/secret-vault/test/proofs.test.ts': L1_PROOF_MARKERS.map((m) => `// ${m}`).join('\n'), [L1_MUTATION_CHECK]: synthMutationScript(MUTATION_PINS[L1_MUTATION_CHECK].ids) } } },
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
  // C4 owns the organization, Review Pool and delegation schema (not later-scope leakage).
  { id: 'no-later-scope-leakage', scenario: { contents: { [`${MIGRATIONS_DIR}0007_c4.sql`]: 'CREATE TABLE org_positions (id TEXT) STRICT;\nCREATE TABLE reviewer_qualifications (id TEXT) STRICT;\nCREATE TABLE work_delegations (id TEXT) STRICT;\nCREATE TABLE authority_delegations (id TEXT) STRICT;\n' } } },
  // C5 owns the Goal model, Founder-facing communication, Founder Attention, sessions and previews (D-C5-01).
  { id: 'no-later-scope-leakage', scenario: { contents: { [`${MIGRATIONS_DIR}0009_c5.sql`]: 'CREATE TABLE goals (id TEXT) STRICT;\nCREATE TABLE communication_threads (id TEXT) STRICT;\nCREATE TABLE communication_messages (id TEXT) STRICT;\nCREATE TABLE founder_attention_items (id TEXT) STRICT;\nCREATE TABLE founder_sessions (id TEXT) STRICT;\nCREATE TABLE founder_action_previews (id TEXT) STRICT;\n' }, dirs: ['bootstrap-contract', 'command-center', 'command-center-ui'] } },
  // A C5 candidate that is explicitly not closed; the surface may name loopback URLs; hashes and codes in telemetry are fine.
  { id: 'c5-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS')}| \`C5\` | Founder | Cloud | IMPLEMENTATION CANDIDATE — NOT CLOSED |\n`, [C5_REPORT]: '# Report\n\nC5 is NOT CLOSED.\n' } } },
  { id: 'founder-listener-loopback-only', scenario: { contents: { 'packages/command-center-ui/src/app/api.ts': "const res = await fetch('http://127.0.0.1:4173/api/universe');\n// see https://example.com/docs for the wire format\n" } } },
  { id: 'c5-telemetry-content-free', scenario: { contents: { 'packages/storage/src/communications.ts': "appendAudit(ctx, 'communication.message', 'thread', t.id, { actorRef }, 'OK', m.purpose, { messageId: id, seq, bodySha256: sha, level: m.level });" } } },
  { id: 'founder-session-scope-confined', scenario: { contents: { 'packages/command-center/src/api.ts': "return ctx.runtime.founder.auth.withSession(ctx.session, (founderRef) => store.send(founderRef, id, input));" } } },
  // A C6 candidate explicitly not closed, R2 / C7 not started; later, C6 closed with its record and R2 started.
  { id: 'c6-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS')}| \`C6\` | Improve | Cloud | IMPLEMENTATION CANDIDATE — NOT CLOSED |\n| \`R2\` | Review | Review | Not started |\n`, [C6_REPORT]: '# Report\n\nC6 is NOT CLOSED.\n' } } },
  { id: 'c6-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap('CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS', 'CLOSED / PASS')}| \`C6\` | Improve | Cloud | CLOSED / MERGED |\n| \`R2\` | Review | Review | IN PROGRESS |\n`, 'docs/C6_CLOSURE_RECORD.md': '' } } },
  // Per-dimension counts, an academy percentage and a regex that FORBIDS score keys are not a universal score.
  { id: 'c6-no-universal-score', scenario: { contents: { 'packages/mind/src/reporting.ts': ' * There is NO universal employee score, rank or leaderboard: one entry per dimension.\nconst FORBIDDEN_PARAM = /score|rank|leaderboard|overall|rating/i;\n', [`${MIGRATIONS_DIR}0006_c3.sql`]: 'CREATE TABLE academy_dimension_results (score_pct INTEGER) STRICT;\n' } } },
  // Hashes, counts and codes in C6 telemetry are fine; the passphrase is used, never written.
  { id: 'c6-telemetry-content-free', scenario: { contents: { 'packages/storage/src/improvement.ts': "appendAudit(ctx, 'evaluation.recorded', 'evaluation', id, { actorRef }, 'OK', state, { workItemId: wid, qualified: true });" } } },
  { id: 'c6-recovery-secret-never-stored', scenario: { contents: { [CLI_SOURCE]: "const passphrase = process.env.QANDEEL_RECOVERY_PASSPHRASE;\n" } } },
  // C7-A: governed evidence with every datastore trigger; content-free intake telemetry; the kernel (only) names the
  // pseudonym; a normalized-fields column; reads of C6 rows; comments that name later scope are not implementations.
  { id: 'c7a-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-A\` | Core | Cloud | IMPLEMENTATION CANDIDATE — NOT CLOSED |\n| \`C7-B\` | Control | Cloud | Not started |\n`, [C7A_REPORT]: '# Report\n\nC7-A is NOT CLOSED (implementation candidate).\n' } } },
  { id: 'c7a-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-A\` | Core | Cloud | CLOSED / MERGED / CANONICAL |\n| \`C7-B\` | Control | Cloud | IN PROGRESS |\n`, 'docs/C7A_CLOSURE_RECORD.md': '' } } },
  { id: 'external-outcomes-governed', scenario: { contents: { [`${MIGRATIONS_DIR}0012_c7a.sql`]:`CREATE TABLE external_records (id TEXT) STRICT;\n${C7A_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n')}\n` } } },
  {
    id: 'c7a-intake-content-free',
    scenario: {
      contents: {
        [EXTERNAL_STORE]: "appendAudit(ctx, 'external.record_accepted', 'external_record', id, a, 'OK', n.lane, { sourceId: source.id, domain: n.domain });\nappendAudit(ctx, 'external.intake_rejected', 'external_source', id, a, 'REJECTED', reason, field === null ? {} : { field });",
        [INTAKE_KERNEL]: "userPseudonym: req({ kind: 'pseudonym' }),",
        [`${MIGRATIONS_DIR}0012_c7a.sql`]: 'CREATE TABLE external_records (\n  id TEXT NOT NULL,\n  normalized_fields_json TEXT NOT NULL,\n  user_scoped INTEGER NOT NULL\n) STRICT;\n',
      },
    },
  },
  { id: 'external-evidence-writes-confined', scenario: { contents: { [EXTERNAL_STORE]: "ctx.db.run('INSERT INTO external_records (id) VALUES (?)', id);", 'packages/storage/test/c7a.test.ts': "db.run('INSERT INTO external_records (id) VALUES (?)', id);", [CLI_SOURCE]: 'out({ health: ExternalEvidenceStore.for(store).health() });\n' } } },
  { id: 'c7a-extends-c6-only', scenario: { contents: { [EXTERNAL_CORE]: "ctx.db.get('SELECT evidence_refs_json AS refs FROM outcome_verifications WHERE id = ?', id);", [`${MIGRATIONS_DIR}0012_c7a.sql`]: 'CREATE TABLE external_records (id TEXT) STRICT;\n' } } },
  { id: 'c7-later-scope-not-leaked', scenario: { contents: { [EXTERNAL_STORE]: '// C7-A has no kill switch, feature flag or social connector (C7-B / C7-D).\nexport const x = 1;\n', 'packages/storage/src/maintenance.ts': "export const records = 'maintenance_records';\nrolloutUpdate(founder, id);\n", [C7B_KERNEL]: "export const CONTROL_FAMILIES = ['FEATURE_FLAG', 'KILL_SWITCH', 'ROUTE_HOLD'] as const;\n", [C7B_MIGRATION]: "CREATE TABLE app_control_families (family TEXT CHECK (family IN ('KILL_SWITCH', 'MAINTENANCE_MODE'))) STRICT;\n" } } },
  // C7-B as an implementation candidate, explicitly not closed, C7-C / C7-D not started; later, closed with its record.
  { id: 'c7b-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-B\` | Control | Cloud | IMPLEMENTATION CANDIDATE — NOT CLOSED |\n| \`C7-C\` | Pilot | Cloud | Not started |\n`, [C7B_REPORT]: '# Report\n\nC7-B is NOT CLOSED (implementation candidate).\n' } } },
  { id: 'c7b-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-B\` | Control | Cloud | CLOSED / MERGED / CANONICAL |\n| \`C7-C\` | Pilot | Cloud | IN PROGRESS |\n`, 'docs/C7B_CLOSURE_RECORD.md': '' } } },
  // The governed control plane: seven families, an empty register, R3, every trigger, ISSUED only; a comment or a quoted
  // refusal message naming "applied" is not a state.
  {
    id: 'c7b-control-plane-governed',
    scenario: {
      contents: {
        [C7B_KERNEL]: `export const CONTROL_FAMILIES = [${C7B_FAMILIES.map((f) => `'${f}'`).join(', ')}] as const;\nexport const PRODUCTION_REMOTE_CONFIG_FAMILIES: readonly RemoteConfigFamily[] = Object.freeze([]);\nexport const APP_CONTROL_RISK = 'R3';\n// Issued is not APPLIED: the App decides what is effective.\n`,
        [C7B_MIGRATION]: `CREATE TABLE app_control_revisions (\n  company_state      TEXT    NOT NULL CHECK (company_state = 'ISSUED')\n) STRICT;\n  family            TEXT    NOT NULL PRIMARY KEY CHECK (family IN (${C7B_FAMILIES.map((f) => `'${f}'`).join(', ')})),\n${C7B_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n')}\n`,
        [C7B_STORE]: "ctx.db.run(`INSERT INTO app_control_revisions (id, company_state) VALUES (?, 'ISSUED')`, id);\nthrow new QandeelError('X', 'issued is not applied in the App');\n",
        'packages/storage/test/c7b.test.ts': "raw.run(`UPDATE app_control_revisions SET company_state = 'APPLIED'`);\n",
      },
    },
  },
  { id: 'c7b-roles-separate', scenario: { contents: { [C7B_MIGRATION]: SYNTH_C7B_SEAT } } },
  // C7-C as an implementation candidate (C7-D not started); later, closed with its record. A Pilot store that only reads
  // the canonical tables and writes its own; comments naming C7-D scope are not implementations.
  { id: 'c7c-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-C\` | Pilot | Cloud | IMPLEMENTATION CANDIDATE — NOT CLOSED |\n| \`C7-D\` | Digital | Cloud | Not started |\n`, [C7C_REPORT]: '# Report\n\nC7-C is NOT CLOSED (implementation candidate).\n' } } },
  { id: 'c7c-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-C\` | Pilot | Cloud | CLOSED / MERGED / CANONICAL |\n| \`C7-D\` | Digital | Cloud | IN PROGRESS |\n`, 'docs/C7C_CLOSURE_RECORD.md': '' } } },
  { id: 'c7c-pilot-governed', scenario: { contents: { [C7C_STORE]: "ctx.db.run(`UPDATE pilots SET state = ? WHERE id = ?`, s, id);\nctx.db.get('SELECT 1 FROM evaluation_results');\n", 'packages/storage/test/c7c.test.ts': "db.run(`UPDATE pilots SET state = 'READY'`);\n", [C7C_MIGRATION]: `CREATE TABLE pilots (\n  id TEXT NOT NULL,\n  title TEXT NOT NULL\n) STRICT;\n${C7C_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n')}\n` } } },
  { id: 'c7c-no-c7d-or-network', scenario: { contents: { [C7C_STORE]: "// C7-D builds the website and publishes; C7-C does not.\nexport const marketClaim = 'NOT_SUPPORTED';\n", [C7C_EVIDENCE]: "export const note = 'never APPLIED in the App';\n" } } },
  // C7-D legitimate states: C7-C closed and C7-D in progress; a report saying the website is NOT built and no vendor was
  // selected; a complete migration with labels and hashes; tests seeding digital rows; a comment naming vendors; the
  // fixed-host transport; least-privilege permissions; an isolated preview.
  { id: 'c7d-requires-c7c-closure', scenario: { contents: { [C7D_STORE]: 'export {};\n', 'docs/C7C_CLOSURE_RECORD.md': '' } } },
  { id: 'c7d-not-claimed-closed', scenario: { contents: { [IMPLEMENTATION_MAP]: `${synthMap()}| \`C7-C\` | Pilot | Cloud | CLOSED / MERGED / CANONICAL |\n| \`C7-D\` | Digital | Cloud | IMPLEMENTATION CANDIDATE — NOT CLOSED |\n`, [C7D_REPORT]: '# Report\n\nC7-D is NOT CLOSED. The QANDEEL website is not built; no hosting vendor was selected.\n' } } },
  { id: 'c7d-digital-governed', scenario: { contents: { [C7D_MIGRATION]: `CREATE TABLE digital_projects (\n  id TEXT NOT NULL,\n  title TEXT NOT NULL,\n  manifest_sha256 TEXT\n) STRICT;\n${C7D_GOVERNED_TRIGGERS.map((t) => `CREATE TRIGGER ${t} BEFORE INSERT ON x BEGIN SELECT 1; END;`).join('\n')}\n`, [C7D_STORE]: "ctx.db.run('UPDATE digital_projects SET state = ? WHERE id = ?', s, id);\nctx.db.get('SELECT state FROM approvals WHERE id = ?', id);\nexport const view = { countsAsMarketOutcome: false };\n", 'packages/storage/test/c7d.test.ts': "db.run('UPDATE digital_revisions SET state = ?', s);\n" } } },
  { id: 'c7d-tool-boundary', scenario: { contents: { [C7D_TRANSPORT]: "import { assertGitHubEndpoint } from './endpoints.js';\nconst GITHUB_API_ORIGIN = 'https://api.github.com';\nconst r = await fetch(`${GITHUB_API_ORIGIN}${request.path}`, { redirect: 'error' });\nassertGitHubEndpoint(request.method, request.path);\n", [C7D_GITHUB_DECLARATION]: "export const GITHUB_TOKEN_PERMISSIONS: Readonly<Record<string, 'read' | 'write'>> = Object.freeze({ contents: 'write', pull_requests: 'write', checks: 'read', statuses: 'read', metadata: 'read' });\n", [C7D_GITHUB_ENDPOINTS]: "const ALLOWED = [\n  { method: 'PUT', re: /pulls\\/1\\/merge/, mutates: true },\n];\nconst FORBIDDEN = /protection|secrets/;\n", [C7D_KERNEL]: "export const DIGITAL_WORKSPACE_DRIVER = 'company.digital-workspace';\n" } } },
  { id: 'c7d-preview-isolated', scenario: { contents: { [C7D_PREVIEW]: "// never the Founder surface's host (127.0.0.1); cookies are never read\nexport const PREVIEW_HOST = '127.0.0.2';\nserver.listen({ host: PREVIEW_HOST, port: 0 });\nconst csp = `sandbox allow-scripts; connect-src 'none'; form-action 'none'; worker-src 'none'`;\nconst robots = 'noindex, nofollow';\n" } } },
  { id: 'c7d-no-vendor-preselection', scenario: { contents: { [C7D_STORE]: "// No vendor (Vercel, Netlify, WordPress, LinkedIn) is chosen here: the Company researches it.\nexport const x = 1;\n", 'packages/tool-drivers/src/github/driver.ts': "export const host = 'github';\n" } } },
  // The canonical five Departments seeded; a review request table carrying the R4 CHECK; tests seeding rows.
  { id: 'review-pool-not-department', scenario: { contents: { [`${MIGRATIONS_DIR}0007_c4.sql`]: CANONICAL_DEPARTMENTS.map((c, i) => `INSERT INTO departments (id, code, name) SELECT 'c4d00000-0000-4000-8000-00000000000${i + 1}', '${c}', 'x' WHERE 1;\n`).join('') } } },
  { id: 'r4-never-review-satisfied', scenario: { contents: { [`${MIGRATIONS_DIR}0008_c4.sql`]: "CREATE TABLE review_requests (\n  risk_level TEXT,\n  state TEXT,\n  CHECK (risk_level <> 'R4' OR state NOT IN ('SATISFIED', 'CONSUMED'))\n) STRICT;\n", [AUTHORITY_KERNEL]: "  if (req.risk === 'R4') return { effect: 'DENY', code: 'FOUNDER_ONLY' };\n" } } },
  { id: 'organization-writes-confined', scenario: { contents: { 'packages/storage/src/org-core.ts': "ctx.db.run('UPDATE position_assignments SET status = ? WHERE id = ?', s, id);", 'packages/storage/test/c4.test.ts': "db.run('INSERT INTO review_plans (id) VALUES (?)', id); rt.org.review.declarePlan(founder, id, plan);" } } },
  { id: 'c4-telemetry-content-free', scenario: { contents: { 'packages/storage/src/review-core.ts': "appendAudit(ctx, 'review.decided', 'review_decision', id, a, 'OK', d.outcome, { requestId, keyKind, counts: true, reasonCode: 'x' });" } } },
  { id: 'budget-mutation-scoped', scenario: { contents: { 'packages/storage/test/migrations.test.ts': "db.run(`INSERT INTO budgets (id) VALUES (?)`, id);" } } },
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
