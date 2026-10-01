#!/usr/bin/env node
// C7-A mutation check: proves the Operational Data + External Outcome Core gates are not vacuous.
//
// Each mutation removes (or bypasses) one semantic gate in the COMPILED output (packages/*/dist), runs the proof
// tests that must catch it, requires them to FAIL, and restores every file (always, in `finally`). Sources are
// never touched; released migrations are never edited (they are pinned by checksum) — the datastore triggers stay as
// defence in depth, so each mutation below is caught by the proof that names the code-level refusal. Run after
// `npm run build`:
//
//   npm run c7a:mutation                          all mutations
//   npm run c7a:mutation -- --shard 2/3           the second of three disjoint shards (CI parallelism)
//   npm run c7a:mutation -- --report <file.json>  also write the ids run / caught (CI proof parity)
//
// A mutation the tests do not catch - or one that no longer applies because the guarded code moved - fails this
// script. The families are the C7-A brief's adversarial proofs (section 18): privacy refusal by name, free text,
// secret-shaped values, unknown fields, the never-stored pseudonym, source governance and lifecycle, schema drift,
// idempotency and conflicting replays, Founder-only authority, the operational-fact ≠ outcome-evidence separation, the
// one usable-evidence predicate (source, conflict, binding), the Review Pool recheck, and the C6 seams (evidence class,
// dependency failure, reports, the Eval Registry gate, Founder Attention).

import { spawnSync } from 'node:child_process';
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
];

// --shard i/n (1-based) runs a disjoint slice; --report <file> records the ids run and caught.
const args = process.argv.slice(2);
const shardArg = args.includes('--shard') ? String(args[args.indexOf('--shard') + 1]) : '1/1';
const reportFile = args.includes('--report') ? String(args[args.indexOf('--report') + 1]) : null;
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
  if (!inShard(index)) continue;
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
