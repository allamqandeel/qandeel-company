#!/usr/bin/env node
// C7-C mutation check: proves the Pilot Instrumentation Pack gates are not vacuous.
//
// Each mutation removes (or bypasses) one semantic gate in the COMPILED output (packages/*/dist), runs the proof
// tests that must catch it, requires them to FAIL, and restores every file (always, in `finally`). TypeScript sources
// are never touched. A DATASTORE mutation (the 0014 triggers / indexes that hold the Pilot lifecycle without
// TypeScript) edits the C7-C migration for that one run and re-pins it in the compiled pin table only
// (`dist/src/migrations.js`), so the proofs open a database built by the mutated schema; both files are restored.
// Run after `npm run build`:
//
//   npm run c7c:mutation                          all mutations
//   npm run c7c:mutation -- --shard 2/3           the second of three disjoint shards (CI parallelism)
//   npm run c7c:mutation -- --report <file.json>  also write the ids run / caught (CI proof parity)
//   npm run c7c:mutation -- --only <id,id>        only the named mutations (a local focus; never a parity report)
//
// A mutation the tests do not catch - or one that no longer applies because the guarded code moved - fails this
// script. The families are the C7-C brief's invariants (section 22): READY without briefing evidence, ACTIVE without an
// active root Goal, a message read as authority, terminal revival, activity counted as performance, universal
// aggregation, attribution bypass, review bypass, a contested external outcome counted, internal training called
// market success, an issued C7-B control counted as an outcome, Pilot audit leaking content, economics bypassing the
// canonical ledger / overhead, duplicate linkage, a Founder decision bypass and a non-idempotent step.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIFECYCLE = { cwd: 'packages/governance', tests: ['dist/test/c7c-pilot-kernel.test.js'] };
const EVIDENCE = { cwd: 'packages/mind', tests: ['dist/test/c7c-pilot-evidence.test.js'] };
const STORE = { cwd: 'packages/storage', tests: ['dist/test/c7c-pilots.test.js'] };

const GOV = 'packages/governance/dist/src';
const MIND = 'packages/mind/dist/src';
const STORAGE = 'packages/storage/dist/src';
const MIGRATION = 'packages/storage/migrations/0014_c7c_pilot_instrumentation.sql';
const PINS = `${STORAGE}/migrations.js`;

const MUTATIONS = [
  // --- Lifecycle: briefing before READY, a root Goal before ACTIVE, forward only (code and datastore) ------------------
  {
    id: 'c7c-ready-without-briefing',
    gate: 'READY needs a governed reply to a Founder briefing request (code)',
    edits: [{ file: `${STORAGE}/pilots.js`, search: "if (input.to === 'READY' && !txBriefingStatus(ctx, p).conversationEvidenced) {", replace: 'if (false) {', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-db-ready-without-briefing',
    gate: 'READY needs a governed reply to a Founder briefing request (datastore)',
    edits: [{ file: MIGRATION, search: "CREATE TRIGGER pilots_ready_requires_briefing BEFORE UPDATE ON pilots\nWHEN NEW.state = 'READY'", replace: "CREATE TRIGGER pilots_ready_requires_briefing BEFORE UPDATE ON pilots\nWHEN 0 AND NEW.state = 'READY'", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-briefing-boundary-dropped',
    gate: 'only Founder requests at or after the Pilot\'s own briefing boundary count (an older exchange in a reused thread never does; code)',
    edits: [{ file: `${STORAGE}/pilots.js`, search: 'WHERE m.thread_id = ? AND m.seq >= ? AND', replace: 'WHERE m.thread_id = ? AND ? > 0 AND', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-db-briefing-boundary-dropped',
    gate: 'only Founder requests at or after the Pilot\'s own briefing boundary count (datastore READY trigger)',
    edits: [{ file: MIGRATION, search: 'WHERE m.thread_id = NEW.briefing_thread_id AND m.seq >= NEW.briefing_from_seq AND', replace: 'WHERE m.thread_id = NEW.briefing_thread_id AND', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-message-read-as-authority',
    gate: 'a Founder message alone (no governed reply) is never briefing evidence',
    edits: [{ file: `${STORAGE}/pilots.js`, search: 'const answered = rows.filter((r) => r.answered === 1)', replace: 'const answered = rows.filter(() => true)', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-active-without-root-goal',
    gate: 'ACTIVE needs an active, Founder-approved root Company Goal with success criteria (code)',
    edits: [{ file: `${STORAGE}/pilots.js`, search: "if (g.kind !== 'COMPANY' || g.state !== 'ACTIVE' || g.approvedByRef === null || g.successCriteria.length === 0)", replace: 'if (false)', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-db-active-without-root-goal',
    gate: 'ACTIVE needs an active, Founder-approved root Company Goal with success criteria (datastore)',
    edits: [{ file: MIGRATION, search: "CREATE TRIGGER pilots_active_requires_root_goal BEFORE UPDATE ON pilots\nWHEN NEW.state = 'ACTIVE'", replace: "CREATE TRIGGER pilots_active_requires_root_goal BEFORE UPDATE ON pilots\nWHEN 0 AND NEW.state = 'ACTIVE'", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-terminal-pilot-revived',
    gate: 'a terminal Pilot never revives (kernel lifecycle)',
    edits: [{ file: `${GOV}/pilot.js`, search: 'COMPLETED: [],', replace: "COMPLETED: ['ACTIVE'],", expectedCount: 1 }],
    runs: [LIFECYCLE],
  },
  {
    id: 'c7c-db-terminal-pilot-revived',
    gate: 'a terminal Pilot never revives (datastore forward-only trigger)',
    edits: [{ file: MIGRATION, search: "CREATE TRIGGER pilots_forward BEFORE UPDATE ON pilots\nWHEN NOT (", replace: "CREATE TRIGGER pilots_forward BEFORE UPDATE ON pilots\nWHEN 0 AND NOT (", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-db-mode-mutable',
    gate: 'a Pilot\'s mode never changes after creation (datastore)',
    edits: [{ file: MIGRATION, search: 'WHEN NEW.id IS NOT OLD.id OR NEW.mode IS NOT OLD.mode OR', replace: 'WHEN NEW.id IS NOT OLD.id OR', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-founder-decision-bypass',
    gate: 'every Pilot step is the Founder\'s own act (never an Employee or a reference)',
    edits: [{ file: `${STORAGE}/pilots.js`, search: "const p = founder(ctx, actorRef, null, 'pilot lifecycle');", replace: "const p = { kind: 'FOUNDER', ref: actorRef };", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-repeated-step-not-idempotent',
    gate: 'repeating a step the Pilot already took is a deterministic no-op',
    edits: [{ file: `${STORAGE}/pilots.js`, search: 'if (plan.noop)\n        return p;', replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Duplicate linkage ------------------------------------------------------------------------------------------
  {
    id: 'c7c-duplicate-thread-linkage',
    gate: 'a briefing thread briefs one Pilot only',
    edits: [{ file: `${STORAGE}/pilots.js`, search: "if (ctx.db.get('SELECT 1 AS x FROM pilots WHERE briefing_thread_id = ?', threadId))", replace: 'if (false)', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c7c-duplicate-root-goal-linkage',
    gate: 'one root Goal is never bound to two Pilots (code and datastore)',
    edits: [
      { file: `${STORAGE}/pilots.js`, search: "if (ctx.db.get('SELECT 1 AS x FROM pilots WHERE root_goal_id = ?', goalId))", replace: 'if (false)', expectedCount: 1 },
      { file: MIGRATION, search: 'CREATE UNIQUE INDEX pilots_one_per_root_goal ON pilots (root_goal_id) WHERE root_goal_id IS NOT NULL;', replace: '', expectedCount: 1 },
    ],
    runs: [STORE],
  },
  // --- Evaluation integrity (C6 reused, never replaced) -------------------------------------------------------------
  {
    id: 'c7c-activity-counted-as-performance',
    gate: 'participation / activity never supports appropriate autonomy without sufficient C6 evidence',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: "if (count((d) => d.state === 'SUFFICIENT_EVIDENCE' && (d.level === 'STRONG' || d.level === 'ADEQUATE')) > 0)", replace: 'if (a.profiles.length > 0)', expectedCount: 1 }],
    runs: [EVIDENCE],
  },
  {
    id: 'c7c-universal-aggregation',
    gate: 'readiness carries no blended / overall number',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: 'evidenceRefs: evidenceRefs.slice(0, 50), isDecision: false })', replace: 'evidenceRefs: evidenceRefs.slice(0, 50), isDecision: false, overallScore: 1 })', expectedCount: 1 }],
    runs: [EVIDENCE],
  },
  {
    id: 'c7c-attribution-bypass',
    gate: 'blame comes only from a VALIDATED C6 attribution',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: "const validated = attribution !== null && attribution.state === 'VALIDATED';", replace: 'const validated = attribution !== null;', expectedCount: 1 }],
    runs: [EVIDENCE],
  },
  {
    id: 'c7c-unauthorized-initiative-counted',
    gate: 'an item whose JUDGMENT is an authority-boundary refusal adds no positive INITIATIVE in a Pilot',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: "if (fact.verdicts.JUDGMENT !== 'NEGATIVE' || fact.verdicts.INITIATIVE !== 'POSITIVE')", replace: 'if (true)', expectedCount: 1 }],
    runs: [EVIDENCE],
  },
  {
    id: 'c7c-boundary-refusal-as-autonomy',
    gate: 'an authority-boundary refusal is never classified as autonomy',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: "if (judgment?.verdict === 'NEGATIVE')\n        return 'AUTHORITY_BOUNDARY_REFUSED';", replace: '', expectedCount: 1 }],
    runs: [EVIDENCE],
  },
  {
    id: 'c7c-review-bypass',
    gate: 'a maker self-decision is a review-discipline concern',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: 'r.makerDecisions > 0 || r.openConflicts > 0', replace: 'r.openConflicts > 0', expectedCount: 1 }],
    runs: [EVIDENCE],
  },
  {
    id: 'c7c-training-completion-as-improvement',
    gate: 'training completed is not improvement (later comparable evidence is)',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: "l.improvementObserved > 0 ? 'SUPPORTED'", replace: "l.improvementObserved + l.trainingCompletedUntested > 0 ? 'SUPPORTED'", expectedCount: 1 }],
    runs: [EVIDENCE],
  },
  {
    id: 'c7c-zero-qualified-efficient',
    gate: 'money spent with zero qualified outcomes is never efficient',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: "e.totalCostMicros > 0 ? 'CONCERN'", replace: "e.totalCostMicros > 0 ? 'SUPPORTED'", expectedCount: 1 }],
    runs: [EVIDENCE],
  },
  {
    id: 'c7c-economics-bypass-ledger',
    gate: 'Pilot economics are C6 cost per qualified outcome over every scoped evaluation (failures and overhead included)',
    edits: [{ file: `${STORAGE}/pilots.js`, search: 'const economics = costPerQualifiedOutcome(evals);', replace: 'const economics = costPerQualifiedOutcome(evals.filter((e) => e.qualifiedOutcome));', expectedCount: 1 }],
    runs: [STORE],
  },
  // --- C7-A / C7-B boundaries ----------------------------------------------------------------------------------------
  {
    id: 'c7c-contested-outcome-counted',
    gate: 'a late C7-A conflict contests the Pilot market claim at once',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: "if (external.contested > 0)\n        return 'CONTESTED';", replace: '', expectedCount: 1 }],
    runs: [EVIDENCE, STORE],
  },
  {
    id: 'c7c-training-called-market-success',
    gate: 'a TRAINING_INTERNAL Pilot never claims market success',
    edits: [{ file: `${MIND}/pilot-evidence.js`, search: "if (mode === 'TRAINING_INTERNAL')\n        return 'NOT_CLAIMABLE_TRAINING_INTERNAL';", replace: '', expectedCount: 1 }],
    runs: [EVIDENCE],
  },
  {
    id: 'c7c-issued-control-as-outcome',
    gate: 'an issued C7-B control is never a Pilot outcome',
    edits: [{ file: `${STORAGE}/pilots.js`, search: 'qualifiedOutcomes: qualified,', replace: "qualifiedOutcomes: qualified + proposals.filter((x) => x.state === 'ISSUED').length,", expectedCount: 1 }],
    runs: [STORE],
  },
  // --- Rule A ------------------------------------------------------------------------------------------------------
  {
    id: 'c7c-audit-leaks-content',
    gate: 'Pilot audit rows carry ids, states and codes only (never the title)',
    edits: [{ file: `${STORAGE}/pilots.js`, search: '{ from: p.state, to: plan.to, mode: p.mode,', replace: '{ from: p.state, to: plan.to, mode: p.mode, title: p.title.slice(0, 100),', expectedCount: 1 }],
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
      console.log(`c7c-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the gate in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
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
      console.log(`c7c-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`c7c-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ script: 'c7c:mutation', shard: shardArg, total: MUTATIONS.length, ran, caught }, null, 2)}\n`);
if (failures) {
  console.log(`c7c-mutation: FAIL — ${failures} of ${ran.length} mutation(s) not caught (shard ${shardArg})`);
  process.exit(1);
}
console.log(`c7c-mutation: ok — ${caught.length} of ${ran.length} mutation(s) caught (shard ${shardArg})`);
