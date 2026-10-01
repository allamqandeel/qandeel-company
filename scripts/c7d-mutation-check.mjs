#!/usr/bin/env node
// C7-D mutation check: proves the Digital Presence Creation & Operations gates are not vacuous.
//
// Each mutation removes (or bypasses) one semantic gate in the COMPILED output (packages/*/dist), runs the proof
// tests that must catch it, requires them to FAIL, and restores every file (always, in `finally`). TypeScript sources
// are never touched. A DATASTORE mutation (the 0015 triggers that hold the workshop without TypeScript) edits the C7-D
// migration for that one run and re-pins it in the compiled pin table only (`dist/src/migrations.js`), so the proofs
// open a database built by the mutated schema; both files are restored. Run after `npm run build`:
//
//   npm run c7d:mutation                          all mutations
//   npm run c7d:mutation -- --shard 2/3           the second of three disjoint shards (CI parallelism)
//   npm run c7d:mutation -- --report <file.json>  also write the ids run / caught (CI proof parity)
//   npm run c7d:mutation -- --only <id,id>        only the named mutations (a local focus; never a parity report)
//
// A mutation the tests do not catch - or one that no longer applies because the guarded code moved - fails this
// script. The families are the C7-D brief's invariants (section 31): a finalized revision made mutable, traversal or a
// secret path accepted, a corrupt artifact accepted, review / Founder approval bypassed, the exact-candidate hash
// ignored, the repository allowlist or the endpoint allowlist removed, broader token permissions accepted, an unknown
// outcome retried, a replay duplicated, the expected head / clean-merge / checks guards removed, Preview isolation
// weakened (sandbox, host, source served, integrity), a fake SEO score, the social version / window checks removed, a
// refused act regenerated, hosting preview and production collapsed, a rollback unbound, publication counted as a market
// outcome, secret content accepted, workspace ownership or chunk integrity dropped, and datastore immutability removed.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = { cwd: 'packages/governance', tests: ['dist/test/c7d-digital-kernel.test.js'] };
const SEO = { cwd: 'packages/mind', tests: ['dist/test/c7d-seo.test.js'] };
const STORE = { cwd: 'packages/storage', tests: ['dist/test/c7d-digital.test.js'] };
const GITHUB = { cwd: 'packages/tool-drivers', tests: ['dist/test/c7d-github.test.js'] };
const SEAMS = { cwd: 'packages/tool-drivers', tests: ['dist/test/c7d-seams.test.js'] };
const PREVIEW = { cwd: 'packages/command-center', tests: ['dist/test/c7d-preview.test.js'] };
const RUNTIME = { cwd: 'packages/runtime', tests: ['dist/test/c7d/c7d-runtime.test.js'] };

const GOV = 'packages/governance/dist/src';
const MIND = 'packages/mind/dist/src';
const STORAGE = 'packages/storage/dist/src';
const DRIVERS = 'packages/tool-drivers/dist/src';
const CC = 'packages/command-center/dist/src';
const MIGRATION = 'packages/storage/migrations/0015_c7d_digital_presence.sql';
const PINS = `${STORAGE}/migrations.js`;

const MUTATIONS = [
  // --- Workshop: paths, secrets, ownership, chunks, immutability (code and datastore) -------------------------------
  {
    id: 'c7d-path-traversal-accepted',
    gate: 'a logical path never traverses (.. / . / empty segments)',
    edits: [{ file: `${GOV}/digital.js`, search: "if (seg.length === 0 || seg === '.' || seg === '..')\n            return refuse('PATH_TRAVERSAL', 'path');", replace: '', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7d-secret-path-accepted',
    gate: 'credential files (.env*, keys, certificates…) are never workshop paths',
    edits: [{ file: `${GOV}/digital.js`, search: "return refuse('PATH_CREDENTIAL_FILE', 'path');", replace: 'return path;', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7d-secret-content-accepted',
    gate: 'text content carrying secret material is refused before it reaches the Artifact Store',
    edits: [{ file: `${STORAGE}/digital.js`, search: "if (containsSecretMaterial(text.slice(i, i + WINDOW)))\n            refuse('SECRET_MATERIAL');", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-finalized-revision-mutable',
    gate: 'a finalized revision refuses every edit (code)',
    edits: [{ file: `${STORAGE}/digital.js`, search: "if (r.state !== 'WORKING')\n        refuse('REVISION_NOT_WORKING');", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-db-finalized-files-mutable',
    gate: 'a finalized revision\'s files never change (datastore)',
    edits: [{ file: MIGRATION, search: 'CREATE TRIGGER digital_revision_files_working_only_u BEFORE UPDATE ON digital_revision_files\nWHEN (SELECT state', replace: 'CREATE TRIGGER digital_revision_files_working_only_u BEFORE UPDATE ON digital_revision_files\nWHEN 0 AND (SELECT state', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-db-revision-unfrozen',
    gate: 'a finalized revision (its manifest hash) is immutable (datastore)',
    edits: [{ file: MIGRATION, search: "CREATE TRIGGER digital_revisions_frozen BEFORE UPDATE ON digital_revisions\nWHEN OLD.state <> 'WORKING' OR", replace: "CREATE TRIGGER digital_revisions_frozen BEFORE UPDATE ON digital_revisions\nWHEN 0 AND OLD.state <> 'WORKING' OR", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-workspace-ownership-dropped',
    gate: 'a working revision is edited only by runs of the Work Item that opened it',
    edits: [{ file: `${STORAGE}/digital.js`, search: "if (r.workItemId !== workItemId)\n        refuse('REVISION_NOT_OWNED');", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-chunk-hash-ignored',
    gate: 'each authoring chunk matches its declared hash',
    edits: [{ file: `${STORAGE}/digital.js`, search: "if (sha256Hex(bytes) !== s(args.chunkSha256))\n                refuse('CHUNK_HASH_MISMATCH');", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-db-candidate-mutable',
    gate: 'a release candidate never changes (datastore)',
    edits: [{ file: MIGRATION, search: 'CREATE TRIGGER digital_release_candidates_immutable_u BEFORE UPDATE ON digital_release_candidates BEGIN', replace: 'CREATE TRIGGER digital_release_candidates_immutable_u BEFORE UPDATE ON digital_release_candidates WHEN 0 BEGIN', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-corrupt-artifact-accepted',
    gate: 'a missing or corrupt object makes the candidate not intact (never approvable or promotable)',
    edits: [{ file: `${STORAGE}/digital.js`, search: "return bad === undefined && rev?.st === 'FINALIZED'", replace: "return rev?.st === 'FINALIZED'", expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Exact candidate binding -------------------------------------------------------------------------------------
  {
    id: 'c7d-export-args-unbound',
    gate: 'a driver resolves only the promotion its exact approved arguments name (hash and canonical form)',
    edits: [{ file: `${STORAGE}/digital.js`, search: "if (p.argsSha256 !== sha256Hex(canonicalJson(args)) || canonicalJson(p.args) !== canonicalJson(args))\n                refuse('PROMOTION_ARGS_MISMATCH');", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-db-promotion-hash-unbound',
    gate: 'a promotion\'s arguments name exactly its candidate\'s manifest hash (datastore)',
    edits: [{ file: MIGRATION, search: "  OR json_extract(NEW.args_json, '$.manifestSha256') IS NOT (SELECT manifest_sha256 FROM digital_release_candidates WHERE id = NEW.candidate_id)\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-db-promotion-not-external',
    gate: 'a promotion is carried only by an external R3+ action (datastore)',
    edits: [{ file: MIGRATION, search: "  OR (SELECT a.mutates_external || a.risk_level FROM tool_actions a WHERE a.id = NEW.tool_action_id) NOT IN ('1R3', '1R4')\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-db-target-identity-mutable',
    gate: 'a promotion target\'s allowlisted identifier never changes (datastore)',
    edits: [{ file: MIGRATION, search: '  OR NEW.external_ref IS NOT OLD.external_ref OR NEW.capability_json IS NOT OLD.capability_json', replace: '  OR NEW.capability_json IS NOT OLD.capability_json', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7d-refused-promotion-regenerates',
    gate: 'a Founder-rejected or review-rejected act never regenerates for the same candidate, target and kind',
    edits: [{ file: `${STORAGE}/digital.js`, search: "if (siblings.some((v) => isRefusedPromotion(v.state)))\n        refuse('PROMOTION_REFUSED_BEFORE');", replace: '', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'c7d-publication-as-market-outcome',
    gate: 'a provider-confirmed publication never counts as a Pilot or market outcome',
    edits: [{ file: `${STORAGE}/digital.js`, search: 'publicationIsMarketSuccess: false,', replace: 'publicationIsMarketSuccess: true,', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Review and Founder approval of the exact external act (the canonical C2 / C4 gates, exercised by C7-D) ------
  {
    id: 'c7d-review-bypassed',
    gate: 'an R3 promotion is independently reviewed (Review Pool) before the Founder is asked',
    edits: [{ file: `${STORAGE}/governed-writes.js`, search: "if (decision.review === 'INDEPENDENT') {", replace: 'if (false) {', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  {
    id: 'c7d-founder-approval-bypassed',
    gate: 'an R3 promotion executes only on the Founder\'s approval of exactly its arguments',
    edits: [{ file: `${STORAGE}/governed-writes.js`, search: "if (decision.approval === 'FOUNDER') {", replace: 'if (false) {', expectedCount: 1 }],
    runs: [RUNTIME],
  },
  // --- GitHub adapter -------------------------------------------------------------------------------------------------
  {
    id: 'c7d-repository-allowlist-removed',
    gate: 'only host-allowlisted repositories are reachable',
    edits: [{ file: `${DRIVERS}/github/driver.js`, search: "if (!this.#allowed.has(r.full.toLowerCase()))\n            no('REPOSITORY_NOT_ALLOWLISTED');", replace: '', expectedCount: 1 }],
    runs: [GITHUB],
  },
  {
    id: 'c7d-token-permissions-broadened',
    gate: 'an installation token broader than the declared permissions fails closed',
    edits: [{ file: `${DRIVERS}/github/auth.js`, search: "if (!permissionsWithinRequest(b.permissions))\n        throw denied('PERMISSIONS_BROADER_THAN_REQUESTED');", replace: '', expectedCount: 1 }],
    runs: [GITHUB],
  },
  {
    id: 'c7d-endpoint-allowlist-removed',
    gate: 'no admin / protection / secret / delete / PATCH endpoint is ever sent',
    edits: [{ file: `${DRIVERS}/github/endpoints.js`, search: "if (!hit || FORBIDDEN.test(area) || path.includes('..') || path.includes('//')) {", replace: 'if (false) {', expectedCount: 1 }],
    runs: [GITHUB],
  },
  {
    id: 'c7d-unknown-outcome-retried',
    gate: 'an unanswered call after a visible mutation is UNKNOWN (held for reconciliation), never a safe retry',
    edits: [{ file: `${DRIVERS}/github/driver.js`, search: "return { ok: false, code: mutated ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNREACHABLE', sent: mutated ? 'UNKNOWN' : 'NO' };", replace: "return { ok: false, code: 'PROVIDER_UNREACHABLE', sent: 'NO' };", expectedCount: 1 }],
    runs: [GITHUB, RUNTIME],
  },
  {
    id: 'c7d-replay-not-recognized',
    gate: 'a replayed export returns the same refs and creates nothing',
    edits: [{ file: `${DRIVERS}/github/driver.js`, search: "if (prior !== 'ABSENT' && prior.pullNumber !== null)\n            return {", replace: "if (false)\n            return {", expectedCount: 1 }],
    runs: [GITHUB],
  },
  {
    id: 'c7d-expected-head-guard-removed',
    gate: 'a production merge binds the exported head (a moved head refuses before any merge call)',
    edits: [{ file: `${DRIVERS}/github/driver.js`, search: "if (s.headSha !== expected)\n            no('HEAD_CHANGED');", replace: '', expectedCount: 1 }],
    runs: [GITHUB],
  },
  {
    id: 'c7d-protection-gate-removed',
    gate: 'a merge needs a cleanly mergeable PR (protection, required reviews and checks satisfied; no bypass)',
    edits: [{ file: `${DRIVERS}/github/driver.js`, search: "if (s.mergeableState !== 'clean')\n            no('MERGE_NOT_READY');", replace: '', expectedCount: 1 }],
    runs: [GITHUB],
  },
  {
    id: 'c7d-checks-ignored',
    gate: 'a merge needs every check on the exported head completed and green',
    edits: [{ file: `${DRIVERS}/github/driver.js`, search: "if (s.checks.pending > 0 || s.checks.failed > 0 || s.status === 'failure' || s.status === 'error')\n            no('CHECKS_NOT_SATISFIED');", replace: '', expectedCount: 1 }],
    runs: [GITHUB],
  },
  // --- Internal Preview isolation --------------------------------------------------------------------------------
  {
    id: 'c7d-preview-sandbox-removed',
    gate: 'preview responses are sandboxed to an opaque origin',
    edits: [{ file: `${CC}/server/preview-listener.js`, search: "'Content-Security-Policy': `sandbox allow-scripts; default-src 'none';", replace: "'Content-Security-Policy': `default-src 'none';", expectedCount: 1 }],
    runs: [PREVIEW],
  },
  {
    id: 'c7d-preview-on-founder-host',
    gate: 'the preview runs on its own loopback host, never the Founder surface\'s',
    edits: [{ file: `${CC}/server/preview-listener.js`, search: "export const PREVIEW_HOST = '127.0.0.2';", replace: "export const PREVIEW_HOST = '127.0.0.1';", expectedCount: 1 }],
    runs: [PREVIEW],
  },
  {
    id: 'c7d-preview-host-check-removed',
    gate: 'a preview answers only its exact host:port (DNS rebinding refused)',
    edits: [{ file: `${CC}/server/preview-listener.js`, search: "return this.#refuse(res, port, 403, 'HOST_NOT_PREVIEW');", replace: '{}', expectedCount: 1 }],
    runs: [PREVIEW],
  },
  {
    id: 'c7d-preview-serves-source',
    gate: 'framework source is never served or executed by the preview',
    edits: [{ file: `${CC}/server/preview-listener.js`, search: "if (media.kind !== 'STATIC')\n            return this.#refuse(res, port, 404, 'SOURCE_NOT_SERVED');", replace: '', expectedCount: 1 }],
    runs: [PREVIEW],
  },
  {
    id: 'c7d-preview-integrity-ignored',
    gate: 'a corrupt object refuses the whole preview',
    edits: [{ file: `${STORAGE}/digital.js`, search: "refuse('PREVIEW_CONTENT_INTEGRITY');", replace: '{}', expectedCount: 1 }],
    runs: [STORE, PREVIEW],
  },
  // --- SEO, social, hosting ------------------------------------------------------------------------------------------
  {
    id: 'c7d-seo-score-introduced',
    gate: 'the SEO lint reports findings and tallies only — never a score',
    edits: [{ file: `${MIND}/seo.js`, search: "return { pagesChecked: pages.length, findings, bySeverity, basis: 'MECHANICAL_CHECKS_ONLY',", replace: "return { pagesChecked: pages.length, findings, bySeverity, score: Math.max(0, 100 - findings.length * 5), basis: 'MECHANICAL_CHECKS_ONLY',", expectedCount: 1 }],
    runs: [SEO],
  },
  {
    id: 'c7d-social-version-check-removed',
    gate: 'a sunset provider API version fails closed',
    edits: [{ file: `${GOV}/digital.js`, search: "if (!adapterVersionUsable(d, req.at))\n        return { ok: false, code: 'API_VERSION_UNSUPPORTED' };", replace: '', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7d-schedule-window-unbound',
    gate: 'a scheduled post executes only inside the exact window its approval bound',
    edits: [{ file: `${GOV}/digital.js`, search: "if (req.at >= req.notAfter)\n        return { ok: false, code: 'OUTSIDE_APPROVED_WINDOW' };", replace: '', expectedCount: 1 }],
    runs: [KERNEL, SEAMS],
  },
  {
    id: 'c7d-forbidden-capability-declared',
    gate: 'no adapter declares admin / protection / secret / interaction / spend acts',
    edits: [{ file: `${GOV}/digital.js`, search: "if (FORBIDDEN_ADAPTER_CAPABILITY.test(a.actionCode) || INTERACTION_OR_SPEND.test(a.actionCode))\n            refuse('ADAPTER_ACTION_FORBIDDEN');", replace: '', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7d-hosting-preview-production-collapsed',
    gate: 'a hosting adapter declares production publish, rollback and state read as distinct acts',
    edits: [{ file: `${GOV}/digital.js`, search: "if (!kinds.includes(needed))\n                refuse('HOSTING_ACTIONS_INCOMPLETE');", replace: '', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7d-rollback-unbound',
    gate: 'a rollback is bound to the exact current production version',
    edits: [{ file: `${DRIVERS}/hosting.js`, search: "if (current === null || current.version !== String(input.args.expectedCurrentRef))\n                        return fail('CURRENT_VERSION_CHANGED');", replace: '', expectedCount: 1 }],
    runs: [SEAMS],
  },
];

// A datastore mutation re-pins the mutated migration in the compiled pin table (never in source), for that run only.
const sha256 = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
function repin(originals, mutated) {
  for (const [file, text] of [...mutated]) {
    if (!file.endsWith('.sql')) continue;
    const pins = path.join(ROOT, PINS);
    const pinText = mutated.get(pins) ?? readFileSync(pins, 'utf8');
    if (!originals.has(pins)) originals.set(pins, pinText);
    const from = sha256(originals.get(file) ?? '');
    if (pinText.split(from).length !== 2) throw new Error(`the compiled pin table does not pin ${path.basename(file)} exactly once (rebuild)`);
    mutated.set(pins, pinText.split(from).join(sha256(text)));
  }
}

// --shard i/n (1-based) runs a disjoint slice; --report <file> records the ids run and caught.
const args = process.argv.slice(2);
const shardArg = args.includes('--shard') ? String(args[args.indexOf('--shard') + 1]) : '1/1';
const reportFile = args.includes('--report') ? String(args[args.indexOf('--report') + 1]) : null;
// --only <id,id> runs the named mutations (focused local validation); CI and `npm run ci` always run the full set.
const only = args.includes('--only') ? new Set(String(args[args.indexOf('--only') + 1]).split(',')) : null;
if (only !== null && reportFile !== null) throw new Error('--only is a local focus; it never produces a parity report');
for (const id of only ?? []) if (!MUTATIONS.some((m) => m.id === id)) throw new Error(`--only names an unknown mutation: ${id}`);
const [shardIndex, shardCount] = shardArg.split('/').map(Number);
if (!(Number.isInteger(shardIndex) && Number.isInteger(shardCount) && shardCount >= 1 && shardIndex >= 1 && shardIndex <= shardCount)) throw new Error(`--shard must be i/n with 1 <= i <= n (got ${shardArg})`);
const inShard = (i) => i % shardCount === shardIndex - 1;

function failed(r) {
  return r.status !== 0 && (/^# fail [1-9]/m.test(r.stdout ?? '') || /^ℹ fail [1-9]/m.test(r.stdout ?? ''));
}

let failures = 0;
const ran = [];
const caught = [];
let index = -1;
for (const m of MUTATIONS) {
  index++;
  if (!inShard(index) || (only !== null && !only.has(m.id))) continue;
  ran.push(m.id);
  const originals = new Map();
  let applicable = true;
  for (const e of m.edits) {
    const file = path.join(ROOT, e.file);
    const text = originals.get(file) ?? readFileSync(file, 'utf8');
    originals.set(file, text);
    const count = text.split(e.search).length - 1;
    if (count !== (e.expectedCount ?? 1)) {
      console.log(`c7d-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the gate in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
      applicable = false;
    }
  }
  if (!applicable) {
    failures++;
    continue;
  }
  try {
    const mutated = new Map(originals);
    for (const e of m.edits) {
      const file = path.join(ROOT, e.file);
      mutated.set(file, (mutated.get(file) ?? '').split(e.search).join(e.replace));
    }
    repin(originals, mutated);
    for (const [file, text] of mutated) writeFileSync(file, text);
    const caughtBy = m.runs.filter(({ cwd, tests }) => failed(spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: path.join(ROOT, cwd), encoding: 'utf8', shell: false, windowsHide: true, timeout: 900_000, env: TEST_ENV })));
    if (caughtBy.length > 0) {
      caught.push(m.id);
      console.log(`c7d-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`c7d-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ script: 'c7d:mutation', shard: shardArg, total: MUTATIONS.length, ran, caught }, null, 2)}\n`);
if (failures) {
  console.log(`c7d-mutation: FAIL — ${failures} of ${ran.length} mutation(s) not caught (shard ${shardArg})`);
  process.exit(1);
}
console.log(`c7d-mutation: ok — ${caught.length} of ${ran.length} mutation(s) caught (shard ${shardArg})`);
