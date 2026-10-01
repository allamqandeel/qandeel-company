#!/usr/bin/env node
// C7-A mutation check: proves the Operational Data + External Outcome Core gates are not vacuous.
//
// Each mutation removes (or bypasses) one semantic gate in the COMPILED output (packages/*/dist), runs the proof
// tests that must catch it, requires them to FAIL, and restores every file (always, in `finally`). TypeScript sources
// are never touched. A DATASTORE mutation (D-C7A-10 / D-C7A-11: the triggers that hold the registered contract and the
// contest of disputed evidence) edits the C7-A migration for that one run and re-pins it in the compiled pin table only
// (`dist/src/migrations.js`), so the proofs open a database built by the mutated schema; both files are restored.
// Run after `npm run build`:
//
//   npm run c7a:mutation                          all mutations
//   npm run c7a:mutation -- --shard 2/3           the second of three disjoint shards (CI parallelism)
//   npm run c7a:mutation -- --report <file.json>  also write the ids run / caught (CI proof parity)
//   npm run c7a:mutation -- --only <id,id>        only the named mutations (a local focus; never a parity report)
//
// A mutation the tests do not catch - or one that no longer applies because the guarded code moved - fails this
// script. The families are the C7-A brief's adversarial proofs (section 18): privacy refusal by name, free text,
// secret-shaped values, unknown fields, the never-stored pseudonym, source governance and lifecycle, schema drift,
// idempotency and conflicting replays, Founder-only authority, the operational-fact ≠ outcome-evidence separation, the
// one usable-evidence predicate (source, conflict, binding), the Review Pool recheck, and the C6 seams (evidence class,
// dependency failure, reports, the Eval Registry gate, Founder Attention).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = { cwd: 'packages/governance', tests: ['dist/test/c7a-intake.test.js'] };
const STORE = { cwd: 'packages/storage', tests: ['dist/test/c7a-external-evidence.test.js'] };
const SEAM = { cwd: 'packages/mind', tests: ['dist/test/c7a-kernel.test.js'] };

const GOV = 'packages/governance/dist/src';
const MIND = 'packages/mind/dist/src';
const STORAGE = 'packages/storage/dist/src';
const MIGRATION = 'packages/storage/migrations/0012_c7a_operational_data_external_outcomes.sql';
const PINS = `${STORAGE}/migrations.js`;

const MUTATIONS = [
  // --- Privacy: allowlist first, content never kept or echoed -------------------------------------------------
  {
    id: 'c7a-private-field-not-refused-by-name',
    gate: 'private content / credential / raw payload / bag keys are refused by name at any depth before the allowlist',
    edits: [{ file: `${GOV}/external-evidence.js`, search: '            const cls = forbiddenKeyClass(k);\n            if (cls !== null)\n                reject(cls);\n', replace: '', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7a-free-text-admitted',
    gate: 'no value may contain whitespace: free text (raw error text, messages) cannot ride in an identifier',
    edits: [{ file: `${GOV}/external-evidence.js`, search: "            if (/\\s/.test(v))\n                reject('FREE_TEXT_VALUE');\n", replace: '', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7a-secret-value-admitted',
    gate: 'a secret-shaped value (JWT, API key, bearer token) is refused even in a declared field',
    edits: [{ file: `${GOV}/external-evidence.js`, search: 'if (SECRET_VALUE.some((re) => re.test(v)))', replace: 'if (false)', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7a-unknown-field-passes',
    gate: 'an unknown field never passes the allowlist (no generic metadata / attributes bag)',
    edits: [{ file: `${GOV}/external-evidence.js`, search: "        if (!allowed.includes(k))\n            reject('UNKNOWN_FIELD');\n", replace: '', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7a-pseudonym-stored',
    gate: 'a user-scoped diagnostic\'s pseudonym is identity material only, never part of the stored normalized fields',
    edits: [{ file: `${GOV}/external-evidence.js`, search: "            if (t.fields[k]?.spec.kind === 'pseudonym')\n                userScoped = true;\n            else\n                stored[k] = v;", replace: "            if (t.fields[k]?.spec.kind === 'pseudonym')\n                userScoped = true;\n            stored[k] = v;", expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7a-refused-payload-audited',
    gate: 'a refused occurrence is audited by reason code only — its content never reaches audit',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: "reason, field === null ? {} : { field });", replace: "reason, { echo: JSON.stringify(occurrence).slice(0, 128) });", expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Source governance, contracts and lifecycle ----------------------------------------------------------------
  {
    id: 'c7a-inactive-source-ingests',
    gate: 'only an ACTIVE governed source creates evidence (DRAFT / SUSPENDED / RETIRED refuse)',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: "if (source.state !== 'ACTIVE' || source.contract === null)", replace: 'if (source.contract === null)', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-contract-drift-ignored',
    gate: 'a contract definition changed without a version bump (digest mismatch) fails closed',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: 'if (contract === null || contractDigest(contract) !== source.contract.sha256)', replace: 'if (contract === null)', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-metric-family-unchecked',
    gate: 'a source reports only the metrics of its own family (a web source cannot report search results)',
    edits: [{ file: `${GOV}/external-evidence.js`, search: "    if (m.family !== source.family)\n        reject('NOT_ALLOWED_FOR_SOURCE', 'type');\n", replace: '', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c7a-future-occurrence-accepted',
    gate: 'an occurrence dated beyond the bounded clock skew is refused (event time is kept, never invented)',
    edits: [{ file: `${GOV}/external-evidence.js`, search: "    if (Date.parse(occurredAt) > Date.parse(observedAt) + INTAKE_FUTURE_SKEW_MS)\n        reject('OCCURRED_IN_FUTURE', 'occurredAt');\n", replace: '', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7a-source-lifecycle-not-forward',
    gate: 'the source lifecycle moves forward only (nothing silently becomes trusted; RETIRED is final)',
    edits: [{ file: `${GOV}/external-evidence.js`, search: "    const allowed = (from === 'DRAFT' && (to === 'ACTIVE' || to === 'RETIRED'))", replace: "    const allowed = true || (from === 'DRAFT' && (to === 'ACTIVE' || to === 'RETIRED'))", expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7a-source-registry-not-founder',
    gate: 'registering a source is a Founder act through the existing chokepoint',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: "const p = founder(ctx, actorRef, null, 'external source registry');", replace: 'const p = { ref: actorRef };', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-source-activation-not-founder',
    gate: 'activating / suspending / retiring a source is a Founder act through the existing chokepoint',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: "const p = founder(ctx, actorRef, null, 'external source lifecycle');", replace: 'const p = { ref: actorRef };', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Idempotency and provenance ------------------------------------------------------------------------------
  {
    id: 'c7a-conflicting-replay-accepted',
    gate: 'the same producer identity with a different fingerprint is a conflict, never a duplicate',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: 'if (s(existing.fingerprint) === fingerprint)', replace: 'if (true)', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-replay-not-idempotent',
    gate: 'an exact replay returns the canonical record and writes nothing',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: '    if (existing) {', replace: '    if (false) {', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Operational facts vs outcome evidence; bindings are Founder decisions ------------------------------------
  {
    id: 'c7a-operational-fact-as-outcome-evidence',
    gate: 'an operational fact is never bindable as outcome evidence (it cannot verify Company work)',
    edits: [{ file: `${GOV}/external-evidence.js`, search: "    if (role === 'OUTCOME_EVIDENCE')\n        return record.lane === 'EXTERNAL_OUTCOME';", replace: "    if (role === 'OUTCOME_EVIDENCE')\n        return true;", expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c7a-binding-not-founder',
    gate: 'only the Founder binds (or unbinds) evidence to Company work: no Employee self-binding',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: "const p = founder(ctx, actorRef, null, 'external evidence binding');", replace: 'const p = { ref: actorRef };', expectedCount: 2 }],
    runs: [STORE],
  },
  // --- The one usable-evidence predicate (Founder and Review Pool verification) -----------------------------------
  {
    id: 'c7a-external-check-skipped-at-verification',
    gate: 'every outcome verification runs the governed external-evidence rule (both verifier paths)',
    edits: [{ file: `${STORAGE}/outcome-core.js`, search: '    txAssertExternalEvidence(ctx, w.id, input.classes, input.refs);\n', replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-operational-record-citable',
    gate: 'an operational record is never citable as outcome evidence',
    edits: [{ file: `${STORAGE}/external-core.js`, search: "    if (r.lane !== 'EXTERNAL_OUTCOME')\n        return 'NOT_OUTCOME_EVIDENCE';\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-suspended-source-usable',
    gate: 'evidence of a source that is not ACTIVE is not newly usable',
    edits: [{ file: `${STORAGE}/external-core.js`, search: "    if (r.state !== 'ACTIVE')\n        return 'SOURCE_NOT_ACTIVE';\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-conflicted-record-usable',
    gate: 'a record with a conflicting replay is not usable evidence',
    edits: [{ file: `${STORAGE}/external-core.js`, search: "        return 'RECORD_CONFLICTED';\n", replace: "        return null;\n", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-unbound-evidence-usable',
    gate: 'only evidence the Founder bound to THIS Work Item verifies it (no inference, no cross-item reuse)',
    edits: [{ file: `${STORAGE}/external-core.js`, search: "    return bound ? null : 'NOT_BOUND_TO_WORK_ITEM';", replace: '    return null;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-pool-judgment-unchecked',
    gate: 'a pool reviewer judges from external outcomes only on usable evidence bound to the reviewed Work Item',
    edits: [{ file: `${STORAGE}/review-core.js`, search: "        if (judgedClasses.includes('EXTERNAL_OUTCOME') !== (external.length > 0) || external.some((ref) => externalEvidenceProblem(ctx, ref, request.workItemId) !== null)) {", replace: '        if (false) {', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-pool-resolution-not-rechecked',
    gate: 'the pool outcome re-checks cited external evidence at resolution; unusable evidence becomes INCONCLUSIVE for the Founder',
    edits: [{ file: `${STORAGE}/review-core.js`, search: '        if (external.length === 0 || external.some((ref) => externalEvidenceProblem(ctx, ref, request.workItemId) !== null)) {', replace: '        if (false) {', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- The C6 seams ------------------------------------------------------------------------------------------------
  {
    id: 'c7a-external-class-not-evidence',
    gate: 'a verification that cited governed external evidence gives the evaluator the EXTERNAL_OUTCOME evidence class',
    edits: [{ file: `${STORAGE}/improvement-core.js`, search: "    if (externalCited.length > 0)\n        classes.add('EXTERNAL_OUTCOME');\n", replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-dependency-failure-ignored',
    gate: 'a Founder-bound external dependency failure is the evaluator\'s external failure evidence (a non-employee cause)',
    edits: [{ file: `${STORAGE}/improvement-core.js`, search: '            external: externalFailures.length,', replace: '            external: 0,', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-report-always-unavailable',
    gate: 'reports distinguish no governed source / nothing relevant / cited evidence (never a fixed "unavailable")',
    edits: [{ file: `${MIND}/reporting.js`, search: "    if (x.state === 'NO_GOVERNED_SOURCE' || x.sources.length === 0)", replace: '    if (true)', expectedCount: 1 }],
    runs: [SEAM, STORE],
  },
  {
    id: 'c7a-registry-requires-external-without-source',
    gate: 'the Eval Registry may require EXTERNAL_OUTCOME only while a governed source is active',
    edits: [{ file: `${MIND}/evaluation.js`, search: "if (spec.requiredEvidence.includes('EXTERNAL_OUTCOME') && !external.governedSource)", replace: 'if (false)', expectedCount: 1 }],
    runs: [SEAM, STORE],
  },
  {
    id: 'c7a-attention-misses-external-exceptions',
    gate: 'a source awaiting activation and a source integrity conflict reach Founder Attention (material exceptions only)',
    edits: [{ file: `${STORAGE}/attention.js`, search: '    for (const x of externalAttentionSignals(ctx)) {', replace: '    for (const x of []) {', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- D-C7A-11: a late integrity conflict takes the disputed outcome out of current C6 truth --------------------------
  {
    id: 'c7a-contest-not-restated',
    gate: 'a conflicting replay restates C6 current truth in its own transaction (the qualified evaluation is superseded)',
    edits: [{ file: `${STORAGE}/external-evidence.js`, search: 'contested = txOutcomesContestedBy(ctx, conflictId).length;', replace: 'contested = 0;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-contested-verdict-trusted',
    gate: 'the evaluator never trusts a verification that is not current (contested / retracted)',
    edits: [{ file: `${STORAGE}/improvement-core.js`, search: 'const verdict = recorded?.current ? recorded : null;', replace: 'const verdict = recorded;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-contest-not-a-conflict',
    gate: 'a contested outcome is conflicting evidence to the evaluator (never averaged into a verdict)',
    edits: [{ file: `${MIND}/evaluation.js`, search: "    if (ev.outcomeContested === true)\n        out.push('OUTCOME_EVIDENCE_CONTESTED');\n", replace: '', expectedCount: 1 }],
    runs: [SEAM, STORE],
  },
  {
    id: 'c7a-report-presents-contested',
    gate: 'a report presents only current verifications as external results; a contested one is stated as contested',
    edits: [{ file: `${MIND}/reporting.js`, search: 'const current = x.verifications.filter((v) => v.validity === undefined);', replace: 'const current = x.verifications;', expectedCount: 1 }],
    runs: [SEAM, STORE],
  },
  {
    id: 'c7a-attention-misses-contest',
    gate: 'each contested verification is a decision the Founder owes (Founder Attention)',
    edits: [{ file: `${STORAGE}/external-core.js`, search: "WHERE y.state = 'CONTESTED' AND y.seq", replace: "WHERE y.state = 'NEVER' AND y.seq", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-contest-resolution-not-founder',
    gate: 'only the Founder decides a contested verification (uphold / replace / retract), through the existing chokepoint',
    edits: [{ file: `${STORAGE}/improvement.js`, search: "const p = founder(ctx, actorRef, subject.employeeId ? `employee:${subject.employeeId}` : null, 'outcome contest resolution');", replace: 'const p = { ref: actorRef };', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-contested-pattern-counts',
    gate: 'a pattern lesson counts as a contribution only while the success it came from is current qualified truth',
    edits: [{ file: `${STORAGE}/improvement.js`, search: "AND l.stage = 'VALIDATED' AND l.employee_id = ? AND ${PATTERN_OUTCOME_CURRENT}`", replace: "AND l.stage = 'VALIDATED' AND l.employee_id = ?`", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-db-conflict-contests-nothing',
    gate: 'the datastore contests every current verification citing a conflicted record, whoever writes the conflict',
    edits: [{ file: MIGRATION, search: "     AND COALESCE((SELECT y.state FROM outcome_verification_validity y WHERE y.verification_id = o.id ORDER BY y.seq DESC LIMIT 1), 'VALID') IN ('VALID', 'UPHELD');\nEND;", replace: '     AND 0;\nEND;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-db-validity-forgeable',
    gate: 'verification validity moves forward only: no contest without a conflict on cited evidence, no decision without a contest',
    edits: [{ file: MIGRATION, search: "BEGIN SELECT RAISE(ABORT, 'a verification is contested only by a conflict on evidence it cites, and only a contested one is upheld, replaced or retracted (REPLACED / RETRACTED are final)'); END;", replace: 'BEGIN SELECT 1; END;', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- D-C7A-10: the datastore enforces the registered contract, not only TypeScript ------------------------------------
  {
    id: 'c7a-db-contract-not-catalogued',
    gate: 'a source registers only a catalogued contract version, pinned by the catalogued digest',
    edits: [{ file: MIGRATION, search: "BEGIN SELECT RAISE(ABORT, 'a source registers a catalogued contract version for its family and lane, pinned by the catalogued digest'); END;", replace: 'BEGIN SELECT 1; END;', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-db-type-family-unchecked',
    gate: 'a record type belongs to its source family (a SEARCH source never carries a web metric)',
    edits: [{ file: MIGRATION, search: 'AND t.domain = NEW.domain AND t.source_family = s.family', replace: 'AND t.domain = NEW.domain', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-db-type-unchecked',
    gate: 'a record type is one the registered contract defines (no unknown operational type)',
    edits: [{ file: MIGRATION, search: 'AND t.record_type = NEW.record_type AND t.domain = NEW.domain', replace: 'AND t.domain = NEW.domain', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-db-domain-unchecked',
    gate: 'a record carries its type\'s own domain',
    edits: [{ file: MIGRATION, search: 'AND t.record_type = NEW.record_type AND t.domain = NEW.domain', replace: 'AND t.record_type = NEW.record_type', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-db-unit-unchecked',
    gate: 'an outcome record carries its metric\'s own unit',
    edits: [{ file: MIGRATION, search: '     AND t.unit IS NEW.unit AND t.user_scoped = NEW.user_scoped\n', replace: '     AND t.user_scoped = NEW.user_scoped\n', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-db-scope-unchecked',
    gate: 'an outcome record uses a scope its metric allows',
    edits: [{ file: MIGRATION, search: 'AND p.record_type = t.record_type AND p.scope_kind = NEW.scope_kind))', replace: 'AND p.record_type = t.record_type))', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-db-duplicate-keys-admitted',
    gate: 'a record never repeats a field key (SQLite and JSON readers would see different values)',
    edits: [{ file: MIGRATION, search: 'WHEN (SELECT COUNT(*) FROM json_each(NEW.normalized_fields_json)) <> (SELECT COUNT(DISTINCT key) FROM json_each(NEW.normalized_fields_json))\n   OR EXISTS', replace: 'WHEN EXISTS', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7a-db-fields-unchecked',
    gate: 'a record\'s stored fields are exactly its type\'s declared fields, each in its declared shape',
    edits: [{ file: MIGRATION, search: "BEGIN SELECT RAISE(ABORT, 'a record''s stored fields are exactly the fields its contract declares for its type, each in its declared shape'); END;", replace: 'BEGIN SELECT 1; END;', expectedCount: 1 }],
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
      console.log(`c7a-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the gate in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
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
      console.log(`c7a-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`c7a-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ script: 'c7a:mutation', shard: shardArg, total: MUTATIONS.length, ran, caught }, null, 2)}\n`);
if (failures) {
  console.log(`c7a-mutation: FAIL — ${failures} of ${ran.length} mutation(s) not caught (shard ${shardArg})`);
  process.exit(1);
}
console.log(`c7a-mutation: PASS — ${caught.length}/${ran.length} mutations caught (shard ${shardArg}, ${MUTATIONS.length} total)`);
