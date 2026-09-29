#!/usr/bin/env node
// C6 mutation check: proves the Company Improvement Engine gates are not vacuous.
//
// Each mutation removes (or bypasses) one semantic gate in the COMPILED output (packages/*/dist), runs the proof
// tests that must catch it, requires them to FAIL, and restores every file (always, in `finally`). Sources are
// never touched; released migrations are never edited (they are pinned by checksum). Run after `npm run build`:
//
//   npm run c6:mutation                          all mutations
//   npm run c6:mutation -- --shard 2/3           the second of three disjoint shards (CI parallelism)
//   npm run c6:mutation -- --report <file.json>  also write the ids run / caught (CI proof parity)
//
// A mutation the tests do not catch - or one that no longer applies because the guarded code moved - fails this
// script. Every mutation is a semantic failure family of the C6 brief (section 27): completion counted as success,
// activity counted as performance, insufficient evidence judged, the system blamed on the Employee, an evaluator
// that cannot say "unknown", reflection self-validating, patterns auto-shared, holdouts leaking, training taken
// for improvement, endless retraining, recommendations acting, a universal score, cost rewarding cheap failure,
// encryption / checksums / retention / verification / hold bypassed, uncertain effects released, unevidenced
// judgements, and reads that announce a change.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Proof tests resolve the test-only Founder seam through the `qandeel-test` condition (D-C2-13).
const TEST_ENV = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --conditions=qandeel-test`.trim() };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KERNEL = { cwd: 'packages/mind', tests: ['dist/test/c6-kernel.test.js'] };
const STORE = { cwd: 'packages/storage', tests: ['dist/test/c6-improvement.test.js'] };
const RES = { cwd: 'packages/storage', tests: ['dist/test/c6-resilience.test.js'] };
const SIGNAL = { cwd: 'packages/runtime', tests: ['dist/test/c6/c6-runtime.test.js'] };

const MIND = 'packages/mind/dist/src';
const STORAGE = 'packages/storage/dist/src';
const RT = 'packages/runtime/dist/src';

const MUTATIONS = [
  {
    id: 'c6-completion-counts-as-success',
    gate: 'a qualified outcome is independently reviewed AND verified as achieved; COMPLETED alone never is',
    edits: [{ file: `${MIND}/evaluation.js`, search: "return ev.reviewed && ev.outcome === 'ACHIEVED';", replace: 'return ev.completed;', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c6-activity-boosts-performance',
    gate: 'activity (messages, tool calls, tokens, runs) is observability only; it never produces a positive verdict',
    edits: [{ file: `${MIND}/evaluation.js`, search: "if (ev.outcome === 'ACHIEVED')\n                return r('POSITIVE', 'OUTCOME_VERIFIED');", replace: "if (ev.outcome === 'ACHIEVED' || ev.activity.toolCalls >= 10)\n                return r('POSITIVE', 'OUTCOME_VERIFIED');", expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c6-insufficient-evidence-judged',
    gate: 'missing required evidence stays INSUFFICIENT_EVIDENCE; no verdict is invented',
    edits: [{ file: `${MIND}/evaluation.js`, search: 'if (missing.length > 0)\n', replace: 'if (false)\n', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c6-system-cause-blamed-on-employee',
    gate: 'tool / provider / model / context / workflow / requirement / external causes are attributed to the system, not to employee judgement',
    edits: [{ file: `${MIND}/evaluation.js`, search: 'const system = NON_EMPLOYEE_SIGNALS.filter((s) => s.present(ev));', replace: 'const system = [];', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c6-tool-failure-unmapped',
    gate: 'a run that failed because its tool did not execute is TOOL evidence (read from the run\'s recorded failure)',
    edits: [{ file: `${STORAGE}/improvement-core.js`, search: "'TOOL_FAILED', 'TOOL_NOT_EXECUTED',", replace: "'TOOL_FAILED',", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-non-employee-negative-counted',
    gate: 'a failure whose validated cause is not the Employee is never counted against their profile',
    edits: [{ file: `${MIND}/performance.js`, search: 'if (!a.employeeAccountable) {', replace: 'if (false) {', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c6-evaluator-cannot-return-unknown',
    gate: 'the meta-evaluation requires the evaluator to answer ambiguous evidence with "not known"',
    edits: [{ file: `${MIND}/evaluation.js`, search: "pass = e.evidenceState !== 'SUFFICIENT_EVIDENCE' && !judged && !e.qualifiedOutcome;", replace: 'pass = true;', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c6-reflection-bypasses-validation',
    gate: 'a mistake lesson (a reflection included) is validated only on a VALIDATED attribution',
    edits: [{ file: `${MIND}/improvement.js`, search: "{ allowed: false, reason: 'ATTRIBUTION_NOT_VALIDATED' }", replace: "{ allowed: true, reason: 'ATTRIBUTION_NOT_VALIDATED' }", expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c6-lesson-validation-skips-gate',
    gate: 'the C3 lesson validation consults the C6 learning gate before VALIDATED',
    edits: [{ file: `${STORAGE}/memory.js`, search: 'if (!gate.allowed)\n', replace: 'if (false)\n', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-pattern-auto-shared',
    gate: 'a successful pattern expands beyond its author only after verified reuse',
    edits: [{ file: `${MIND}/improvement.js`, search: 'if (verifiedReuses < MIN_VERIFIED_PATTERN_REUSES)\n', replace: 'if (false)\n', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c6-holdout-leaks-to-trainee',
    gate: 'hidden holdout / Gold cases are never retraining material',
    edits: [{ file: `${MIND}/improvement.js`, search: "c.stage === 'REGRESSION_CASE' && !c.hidden", replace: "c.stage === 'REGRESSION_CASE' || c.hidden", expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c6-training-equals-improvement',
    gate: 'training completed is not improvement: without later comparable evidence the effect is NOT_YET_TESTED',
    edits: [{ file: `${MIND}/improvement.js`, search: "{ effect: 'NOT_YET_TESTED', basis: 'NO_COMPARABLE_WORK_YET'", replace: "{ effect: 'IMPROVEMENT_OBSERVED', basis: 'NO_COMPARABLE_WORK_YET'", expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c6-retraining-loops-forever',
    gate: 'repeated ineffective retraining escalates to systemic analysis instead of another cycle',
    edits: [{ file: `${MIND}/improvement.js`, search: 'if (ineffective >= MAX_INEFFECTIVE_RETRAINING_CYCLES)\n', replace: 'if (false)\n', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c6-systemic-credit-misattributed',
    gate: 'a systemic finding credits an Employee only as the author of the reflected observation it came from, never the subject of a system record',
    edits: [{ file: `${MIND}/improvement.js`, search: "return input.source === 'REFLECTION' ? input.observationEmployeeId : null;", replace: 'return input.observationEmployeeId;', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c6-systemic-credit-before-validation',
    gate: 'System Contribution credit for a systemic finding waits for the Founder to validate it',
    edits: [{ file: `${STORAGE}/improvement.js`, search: "WHERE contributor_employee_id = ? AND state IN ('VALIDATED', 'ADDRESSED')", replace: "WHERE contributor_employee_id = ? AND state IN ('CANDIDATE', 'VALIDATED', 'ADDRESSED')", expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-recommendation-mutates-authority',
    gate: 'a report or recommendation changes no authority, budget, grant, approval, seat, hold or certification',
    edits: [{ file: `${STORAGE}/improvement.js`, search: "appendAudit(ctx, 'report.generated'", // The injected write is assembled at run time: this script never writes a budget itself; it plants the defect
    // (a report that acts on authority) in a disposable compiled copy and proves the proofs catch it.
    replace: `ctx.db.run([${JSON.stringify('UPDATE')}, 'budgets', "SET cap_money = cap_money + 1, version = version + 1 WHERE scope = 'COMPANY'"].join(' ')); appendAudit(ctx, 'report.generated'`, expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-universal-score-reintroduced',
    gate: 'a Performance Profile carries no aggregate score, rank or total',
    edits: [{ file: `${MIND}/performance.js`, search: 'employeeId: input.employeeId,\n        window:', replace: 'employeeId: input.employeeId,\n        overallScore: input.evaluations.length,\n        window:', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c6-cost-rewards-cheap-failure',
    gate: 'cost is divided by QUALIFIED outcomes; a cheap unqualified failure has no defined cost per qualified outcome',
    edits: [{ file: `${MIND}/performance.js`, search: 'costPerQualifiedOutcomeMicros: qualified > 0 ? Math.ceil(total / qualified) : null,', replace: 'costPerQualifiedOutcomeMicros: facts.length > 0 ? Math.ceil(total / facts.length) : null,', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c6-backup-encryption-bypassed',
    gate: 'the portable package carries the company only as AES-256-GCM ciphertext',
    edits: [{ file: `${STORAGE}/resilience.js`, search: 'const body = Buffer.concat([cipher.update(payload), cipher.final()]);', replace: 'const body = Buffer.concat([payload, cipher.update(Buffer.alloc(0)), cipher.final()]);', expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-backup-checksum-ignored',
    gate: 're-verification binds the destination package to the checksum the Company recorded',
    edits: [{ file: `${STORAGE}/resilience.js`, search: 'if (sha256Hex(bytes) !== row.package_sha256)\n', replace: 'if (false)\n', expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-retention-keeps-only-latest',
    gate: 'retention keeps several generations, never only the latest',
    edits: [{ file: `${STORAGE}/resilience.js`, search: 'const keep = new Set(ordered.slice(0, policy.keepLast).map', replace: 'const keep = new Set(ordered.slice(0, 1).map', expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-update-activates-before-verification',
    gate: 'the live database is migrated only after the rehearsal on the snapshot is verified',
    edits: [{ file: `${STORAGE}/maintenance.js`, search: 'if (rehearsal !== null)\n', replace: 'if (false)\n', expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-update-hold-ignored',
    gate: 'a workspace in UPDATE_HOLD is never opened (so never re-migrated in a loop)',
    edits: [{ file: `${STORAGE}/store.js`, search: 'assertNoUpdateHold(workspace.root);', replace: '/* mutation: hold ignored */', expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-restore-releases-uncertain-effect',
    gate: 'a restored Company keeps uncertain external effects held for reconciliation (never blindly retried)',
    edits: [{ file: `${STORAGE}/resilience.js`, search: 'UPDATE founder_launch_tokens SET consumed_at = ? WHERE consumed_at IS NULL`, at);', replace: "UPDATE founder_launch_tokens SET consumed_at = ? WHERE consumed_at IS NULL`, at); ctx.db.run(`UPDATE queue_jobs SET state = 'QUEUED', version = version WHERE state = 'RECONCILIATION_HOLD'`);", expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-report-judgement-without-evidence',
    gate: 'an assessment, trend or recommendation cites evidence and carries its uncertainty',
    edits: [{ file: `${MIND}/reporting.js`, search: 'if (!free && c.evidenceRefs.length === 0)\n', replace: 'if (false)\n', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c6-outcome-verified-before-review',
    gate: 'an outcome is verified only after independent review (completion is not success)',
    edits: [{ file: `${STORAGE}/improvement.js`, search: "if (!['REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'].includes(w.state))\n", replace: 'if (false)\n', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-external-outcome-invented',
    gate: 'external outcomes are unavailable until a governed source exists (C7); none is accepted as evidence',
    edits: [{ file: `${STORAGE}/improvement.js`, search: "if (classes.includes('EXTERNAL_OUTCOME') && !EXTERNAL_OUTCOMES_AVAILABLE)\n", replace: 'if (false)\n', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-read-announces-change',
    gate: 'an Improvement read never says the Founder\'s world changed (the C5 refresh-storm contract, D-C5-17)',
    edits: [
      { file: `${RT}/runtime.js`, search: "'inspect', 'health'],", replace: "'inspect'],", expectedCount: 1 },
      { file: `${RT}/runtime.js`, search: "mutating: ['registerDefinition',", replace: "mutating: ['health', 'registerDefinition',", expectedCount: 1 },
    ],
    runs: [SIGNAL],
  },
  {
    id: 'c6-unchanged-derivation-announces',
    gate: 'an idempotent derivation (evaluate, assess, report) announces only when it recorded something new',
    edits: [{ file: `${RT}/runtime.js`, search: 'evaluate: (r) => r.changed,', replace: 'evaluate: (r) => true,', expectedCount: 1 }],
    runs: [SIGNAL],
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
      console.log(`c6-mutation: FAIL ${m.id} — expected ${e.expectedCount ?? 1} occurrence(s) of the gate in ${e.file}, found ${count} (rebuild, or update this check with the code)`);
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
      console.log(`c6-mutation: ok   ${m.id} (${m.gate}) — caught by ${caughtBy.map((r) => r.tests.join(',')).join(' + ')}`);
    } else {
      console.log(`c6-mutation: FAIL ${m.id} (${m.gate}) — no proof test caught the mutation`);
      failures++;
    }
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ script: 'c6:mutation', shard: shardArg, total: MUTATIONS.length, ran, caught }, null, 2)}\n`);
if (failures) {
  console.log(`c6-mutation: FAIL — ${failures} of ${ran.length} mutation(s) not caught (shard ${shardArg})`);
  process.exit(1);
}
console.log(`c6-mutation: PASS — ${caught.length}/${ran.length} mutations caught (shard ${shardArg}, ${MUTATIONS.length} total)`);
