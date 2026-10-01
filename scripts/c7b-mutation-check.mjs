#!/usr/bin/env node
// C7-B mutation check: proves the Governed App Operations Control Plane gates are not vacuous.
//
// Each mutation removes (or bypasses) one semantic gate in the COMPILED output (packages/*/dist), runs the proof
// tests that must catch it, requires them to FAIL, and restores every file (always, in `finally`). TypeScript sources
// are never touched. A DATASTORE mutation (the 0013 triggers / checks that hold the control contract without
// TypeScript) edits the C7-B migration for that one run and re-pins it in the compiled pin table only
// (`dist/src/migrations.js`), so the proofs open a database built by the mutated schema; both files are restored.
// Run after `npm run build`:
//
//   npm run c7b:mutation                          all mutations
//   npm run c7b:mutation -- --shard 2/3           the second of three disjoint shards (CI parallelism)
//   npm run c7b:mutation -- --report <file.json>  also write the ids run / caught (CI proof parity)
//   npm run c7b:mutation -- --only <id,id>        only the named mutations (a local focus; never a parity report)
//
// A mutation the tests do not catch - or one that no longer applies because the guarded code moved - fails this
// script. The families are the C7-B brief's architectural guards (section 33): the seven-family closed set, the R3
// review and Founder-approval requirements, exact-act fingerprint binding, seat / title ≠ authority, the stale-revision
// guard, the datastore family / scope / value contract, no effective-state claim, the negative-only Route Hold, the
// empty Remote Configuration gate, no generic execution, the content-free outbox and the C7-A refusal coalescing bound.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = { cwd: 'packages/governance', tests: ['dist/test/c7b-controls.test.js'] };
const STORE = { cwd: 'packages/storage', tests: ['dist/test/c7b-app-controls.test.js'] };

const GOV = 'packages/governance/dist/src';
const STORAGE = 'packages/storage/dist/src';
const MIGRATION = 'packages/storage/migrations/0013_c7b_governed_app_controls.sql';
const PINS = `${STORAGE}/migrations.js`;

const MUTATIONS = [
  // --- The closed seven-family catalogue ------------------------------------------------------------------------
  {
    id: 'c7b-eighth-family-admitted',
    gate: 'only the seven approved families exist; an eighth family string is refused',
    edits: [{ file: `${GOV}/app-controls.js`, search: "refuse('UNKNOWN_CONTROL_FAMILY', 'family');", replace: 'void 0;', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7b-db-family-catalogue-open',
    gate: 'the datastore family catalogue is closed (no row widened, added or removed at runtime)',
    edits: [{ file: MIGRATION, search: "CREATE TRIGGER app_control_families_closed_u BEFORE UPDATE ON app_control_families BEGIN SELECT RAISE(ABORT, 'the seven control families are closed; a new family needs a controlled Product / Architecture release'); END;", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- R3: grant, seat, independent review, Founder approval ------------------------------------------------------
  {
    id: 'c7b-org-act-not-r3',
    gate: 'a control act is decided at R3 (an R1 / delegated grant never covers it)',
    edits: [{ file: `${STORAGE}/org-writes.js`, search: 'risk: req.risk', replace: "risk: 'R1'", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-grant-family-scope-ignored',
    gate: 'a control grant is decided on the family it covers',
    edits: [{ file: `${STORAGE}/org-writes.js`, search: 'resource: req.resource', replace: "resource: '*'", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-seat-not-required',
    gate: 'Title ≠ Authority and authority ≠ seat: only the App Operations & Release Lead seat (or scoped acting coverage) proposes',
    edits: [{ file: `${STORAGE}/app-controls.js`, search: 'x.position.code === APP_OPERATIONS_LEAD_SEAT && ', replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-proposal-seat-unchecked',
    gate: 'the datastore refuses a proposal by anyone outside the operating seat',
    edits: [{ file: MIGRATION, search: "  OR NOT EXISTS (SELECT 1 FROM org_positions p WHERE p.id = NEW.proposer_position_id AND p.code = 'product.app-operations-release-lead' AND p.status = 'ACTIVE')\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-review-settle-unhooked',
    gate: 'only a satisfied independent review puts the exact act to the Founder',
    edits: [{ file: `${STORAGE}/review-core.js`, search: 'txControlReviewSettled(ctx, request, outcome, actorRef);', replace: 'void 0;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-review-not-required-at-issue',
    gate: 'issuance re-checks that the review of exactly this act is still satisfied',
    edits: [{ file: `${STORAGE}/app-controls.js`, search: "    if (!review)\n        throw new QandeelError('REVIEW_REQUIRED'", replace: "    if (false)\n        throw new QandeelError('REVIEW_REQUIRED'", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-review-not-required',
    gate: 'the datastore issues nothing without the satisfied R3 action review of exactly that act',
    edits: [{ file: MIGRATION, search: "  OR NOT EXISTS (SELECT 1 FROM review_requests q JOIN app_control_proposals p ON p.id = NEW.proposal_id\n                  WHERE q.id = NEW.review_request_id AND q.kind = 'REQUIRED' AND q.subject_kind = 'ACTION' AND q.state = 'SATISFIED' AND q.risk_level = 'R3'\n                    AND q.work_item_id = p.work_item_id AND q.subject_fingerprint = p.fingerprint AND q.subject_ref = 'app_control_proposal:' || p.id)\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-approval-unhooked',
    gate: 'the Founder\'s R3 approval is what issues (approving never leaves the act unissued, rejecting ends it)',
    edits: [{ file: `${STORAGE}/governance.js`, search: 'txControlApprovalDecided(ctx, a, to, p.ref);', replace: 'void 0;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-founder-approval-not-required',
    gate: 'the datastore issues nothing without an APPROVED R3 approval of exactly that act by the issuing Founder',
    edits: [{ file: MIGRATION, search: "  OR NOT EXISTS (SELECT 1 FROM approvals x JOIN app_control_proposals p ON p.id = NEW.proposal_id\n                  WHERE x.id = NEW.approval_id AND x.state = 'APPROVED' AND x.action = 'app-control.issue' AND x.risk_level = 'R3'\n                    AND x.args_sha256 = p.fingerprint AND x.work_item_id = p.work_item_id AND x.decided_by_ref = NEW.issued_by_ref)\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Exact-act binding and the revision law ---------------------------------------------------------------------
  {
    id: 'c7b-fingerprint-ignores-value',
    gate: 'a changed value is a different act: no review or approval carries over',
    edits: [{ file: `${GOV}/app-controls.js`, search: 'operation: p.operation, value: p.value, reasonCode: p.reasonCode', replace: 'operation: p.operation, reasonCode: p.reasonCode', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7b-db-act-not-bound',
    gate: 'the datastore issues exactly the proposed value (no changed payload rides an approval)',
    edits: [{ file: MIGRATION, search: 'AND p.value_json IS NEW.value_json ', replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-stale-expectation-unguarded',
    gate: 'a proposal made against a revision that is no longer current is refused',
    edits: [{ file: `${STORAGE}/app-controls.js`, search: "    if ((current?.revision ?? 0) !== p.expectedRevision)\n        return { refused: 'STALE_EXPECTED_REVISION' };\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-concurrent-proposal-not-staled',
    gate: 'issuing one revision makes every concurrent proposal of the series STALE (never two current revisions)',
    edits: [{ file: `${STORAGE}/app-controls.js`, search: "        moveProposal(ctx, o, 'STALE', 'app_control.series_moved', founderRef);\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-sequence-unguarded',
    gate: 'the datastore admits only the next revision number of a series (no skip, no rollback)',
    edits: [{ file: MIGRATION, search: 'WHEN NEW.revision <> COALESCE((SELECT MAX(r.revision) FROM app_control_revisions r WHERE r.series_id = NEW.series_id), 0) + 1\n  OR ', replace: 'WHEN ', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-no-change-reissued',
    gate: 'a SET identical to the current Company state is no change (never re-issued)',
    edits: [{ file: `${GOV}/app-controls.js`, search: "return 'NO_CHANGE';", replace: 'return null;', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7b-db-history-mutable',
    gate: 'issued revisions are append-only history',
    edits: [{ file: MIGRATION, search: "CREATE TRIGGER app_control_revisions_append_only_u BEFORE UPDATE ON app_control_revisions BEGIN SELECT RAISE(ABORT, 'issued control revisions are append-only history'); END;", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-proposal-revivable',
    gate: 'a proposal only moves forward (a rejected act is never revived)',
    edits: [{ file: MIGRATION, search: "  OR NOT ((OLD.state = 'PROPOSED' AND", replace: "  OR 0 AND NOT ((OLD.state = 'PROPOSED' AND", expectedCount: 1 }],
    runs: [STORE],
  },
  // --- The datastore family / scope / value contract -------------------------------------------------------------
  {
    id: 'c7b-db-family-scope-unchecked',
    gate: 'a family admits only its own scope kinds, even by direct SQL',
    edits: [{ file: MIGRATION, search: 'WHEN NOT EXISTS (SELECT 1 FROM app_control_families f, json_each(f.scope_kinds_json) k WHERE f.family = NEW.family AND k.value = NEW.scope_kind)', replace: 'WHEN 0', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-scope-identifiers-unchecked',
    gate: 'scope identifiers are short opaque codes (no free text, PII or selector), even by direct SQL',
    edits: [{ file: MIGRATION, search: "  OR EXISTS (SELECT 1 FROM json_each(NEW.scope_json) j WHERE j.key <> 'kind' AND NOT (", replace: "  OR EXISTS (SELECT 1 FROM json_each(NEW.scope_json) j WHERE 0 AND NOT (", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-value-unchecked',
    gate: 'every SET carries exactly its family\'s typed value, even by direct SQL',
    edits: [{ file: MIGRATION, search: "  OR (NEW.operation = 'SET' AND NOT (CASE NEW.family", replace: '  OR (0 AND NOT (CASE NEW.family', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-route-hold-selects',
    gate: 'a Route Hold only holds, even by direct SQL',
    edits: [{ file: MIGRATION, search: "json_extract(NEW.value_json, '$.hold') IS 'HELD'", replace: "json_extract(NEW.value_json, '$.hold') IS NOT NULL", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-remote-config-ungated',
    gate: 'Remote Configuration exists only under an APPROVED register family, even by direct SQL',
    edits: [{ file: MIGRATION, search: "WHEN 'APPROVED_REMOTE_CONFIGURATION' THEN (SELECT COUNT(*) FROM json_each(NEW.value_json)) = 2 AND EXISTS (", replace: "WHEN 'APPROVED_REMOTE_CONFIGURATION' THEN (SELECT COUNT(*) FROM json_each(NEW.value_json)) = 2 OR EXISTS (", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-register-open',
    gate: 'no runtime path adds an approved Remote Configuration family (release-only)',
    edits: [{ file: MIGRATION, search: "CREATE TRIGGER app_remote_config_families_release_only BEFORE INSERT ON app_remote_config_families\nBEGIN SELECT RAISE(ABORT, 'NO_APPROVED_REMOTE_CONFIG_FAMILY: an approved Remote Configuration family enters only through a controlled Product + Architecture release'); END;\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-applied-state-admitted',
    gate: 'the Company state of a revision is ISSUED only (never APPLIED / EFFECTIVE in the App)',
    edits: [{ file: MIGRATION, search: "CHECK (company_state = 'ISSUED')", replace: "CHECK (company_state IN ('ISSUED', 'APPLIED', 'EFFECTIVE_IN_APP'))", expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Kernel: negative-only Route Hold, empty Remote Configuration gate, no generic execution -------------------
  {
    id: 'c7b-route-hold-not-negative',
    gate: 'a Route Hold value is only HELD (never a preference or a forced route)',
    edits: [{ file: `${GOV}/app-controls.js`, search: "return one('hold', [ROUTE_HOLD_VALUE]);", replace: "return one('hold', [ROUTE_HOLD_VALUE, 'PREFER', 'FORCE']);", expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7b-route-selection-unnamed',
    gate: 'model / fallback / FAST / DEEP selection fields are refused as selection',
    edits: [{ file: `${GOV}/app-controls.js`, search: 'if (SELECTION_KEY.test(k))', replace: 'if (false)', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7b-remote-config-gate-removed',
    gate: 'with no approved family, Remote Configuration fails closed before any payload is read',
    edits: [{ file: `${GOV}/app-controls.js`, search: 'if (register.length === 0)', replace: 'if (false)', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7b-generic-execution-unnamed',
    gate: 'code / script / SQL / command / expression / prompt / URL fields are refused as generic execution',
    edits: [{ file: `${GOV}/app-controls.js`, search: 'if (EXECUTION_KEY.test(k))', replace: 'if (false)', expectedCount: 1 }],
    runs: [KERNEL],
  },
  // --- TL MAJOR 1: authority re-decided at the issue boundary (seat / acting coverage, current grant) -----------------
  {
    id: 'c7b-issue-seat-unchecked',
    gate: 'nothing issues for a proposer who lost the seat or the acting coverage after proposing',
    edits: [{ file: `${STORAGE}/app-controls.js`, search: "return 'CONTROL_SEAT_NOT_HELD';", replace: 'void 0;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-issue-grant-unchecked',
    gate: 'nothing issues on a grant revoked or expired after proposing',
    edits: [{ file: `${STORAGE}/app-controls.js`, search: "return 'CONTROL_GRANT_NOT_CURRENT';", replace: 'void 0;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-issue-seat-unchecked',
    gate: 'the datastore refuses a revision whose proposer no longer holds the seat at issue time',
    edits: [{ file: MIGRATION, search: "AND a.status = 'ACTIVE' AND a.effective_from <= NEW.issued_at AND (a.effective_to IS NULL OR a.effective_to > NEW.issued_at)", replace: 'AND 1', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-issue-grant-revocation-unchecked',
    gate: 'the datastore refuses a revision on a grant revoked after proposing',
    edits: [{ file: MIGRATION, search: "WHERE p.id = NEW.proposal_id AND g.employee_id = p.proposer_employee_id AND g.status = 'ACTIVE'", replace: 'WHERE p.id = NEW.proposal_id AND g.employee_id = p.proposer_employee_id', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-issue-grant-expiry-unchecked',
    gate: 'the datastore refuses a revision on a grant expired after proposing',
    edits: [{ file: MIGRATION, search: 'AND (g.expires_at IS NULL OR g.expires_at > NEW.issued_at)', replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- TL MAJOR 2: a STALE review (Review Plan superseded) never strands a proposal nor keeps its approval alive ------
  {
    id: 'c7b-stale-hook-unwired',
    gate: 'a control review going STALE reaches the control plane (its proposal and pending approval)',
    edits: [{ file: `${STORAGE}/review-core.js`, search: 'txControlReviewStale(ctx, r, actorRef);', replace: 'void 0;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-stale-review-not-recovered',
    gate: 'a proposal whose review went STALE on plan supersession is reviewed afresh under the active plan',
    edits: [{ file: `${STORAGE}/review-core.js`, search: 'recoverControlReviews(ctx, item.id);', replace: 'void 0;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-stale-approval-not-revoked',
    gate: 'an approval PENDING on a review that went STALE is revoked (it can never issue)',
    edits: [{ file: `${STORAGE}/app-controls.js`, search: "revokePendingApproval(ctx, p.approvalId, 'app_control.review_stale', actorRef);", replace: 'void 0;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-founder-entry-unguarded',
    gate: 'the datastore puts a proposal to the Founder only on a satisfied review and a PENDING approval (never a revoked one)',
    edits: [{ file: MIGRATION, search: "  OR (NEW.state = 'AWAITING_FOUNDER' AND OLD.state <> 'AWAITING_FOUNDER'", replace: "  OR (0 AND NEW.state = 'AWAITING_FOUNDER' AND OLD.state <> 'AWAITING_FOUNDER'", expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Content-free outbox and the C7-A refusal amplification bound -------------------------------------------------
  {
    id: 'c7b-event-carries-content',
    gate: 'the issued-revision event carries ids, codes and a digest only',
    edits: [{ file: `${STORAGE}/app-controls.js`, search: '{ revisionId, revision, family: p.family, operation: p.operation, digest });', replace: '{ revisionId, revision, family: p.family, operation: p.operation, digest, value: canonicalJson(p.value) });', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-refusals-audited-per-row',
    gate: 'repeated refused intake is counted per (source, reason, window), not audited row by row',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: "if (txCountRefusal(ctx, refused.sourceId ?? named ?? 'unresolved', reason))", replace: "if (txCountRefusal(ctx, refused.sourceId ?? named ?? 'unresolved', reason) || true)", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7b-db-refusal-key-unbounded',
    gate: 'a refusal counter is keyed by a registered source or unresolved, never by a supplied string',
    edits: [{ file: MIGRATION, search: "WHEN NEW.source_ref <> 'unresolved' AND NOT EXISTS (SELECT 1 FROM external_sources s WHERE s.id = NEW.source_ref)", replace: 'WHEN 0', expectedCount: 1 }],
    runs: [STORE],
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
      console.log(`c7b-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the gate in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
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
      console.log(`c7b-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`c7b-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ script: 'c7b:mutation', shard: shardArg, total: MUTATIONS.length, ran, caught }, null, 2)}\n`);
if (failures) {
  console.log(`c7b-mutation: FAIL — ${failures} of ${ran.length} mutation(s) not caught (shard ${shardArg})`);
  process.exit(1);
}
console.log(`c7b-mutation: ok — ${caught.length} of ${ran.length} mutation(s) caught (shard ${shardArg})`);
