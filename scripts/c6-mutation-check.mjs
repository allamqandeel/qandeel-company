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
// C6-R1: operational judgment through the Review Pool (verification authority is never execution authority).
const JUDGE_KERNEL = { cwd: 'packages/governance', tests: ['dist/test/c6r1-judgment.test.js'] };
const FREE = { cwd: 'packages/storage', tests: ['dist/test/c6-founder-free.test.js'] };

const MIND = 'packages/mind/dist/src';
const GOV = 'packages/governance/dist/src';
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
    // The cause families live in the one run-failure vocabulary C6 classifies from (R2-12).
    edits: [{ file: `${GOV}/run-failures.js`, search: "TOOL_NOT_EXECUTED: 'TOOL',", replace: 'TOOL_NOT_EXECUTED: null,', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-config-cause-blamed-on-provider',
    gate: 'a run that failed for a missing route policy records that cause and is WORKFLOW evidence, never the provider (R2-12)',
    edits: [{ file: `${GOV}/run-failures.js`, search: "case 'NO_ROUTE_POLICY':\n            return 'NO_ROUTE_POLICY';\n", replace: '', expectedCount: 1 }],
    runs: [SIGNAL],
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
    gate: 'the C3 lesson validation consults the C6 learning gate before VALIDATED (Founder and pool paths share it)',
    edits: [{ file: `${STORAGE}/improvement.js`, search: 'if (!gate.allowed)\n', replace: 'if (false)\n', expectedCount: 1 }],
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
    id: 'c6-separate-volume-counts-as-off-device',
    gate: 'R2-28: only an operator-attested destination meets the off-device objective; a second partition of the same disk never does',
    edits: [{ file: `${STORAGE}/resilience.js`, search: "return domain === 'ATTESTED_OFF_DEVICE';", replace: "return domain !== 'SAME_VOLUME';", expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-restore-dispatches-past-backup-point',
    gate: 'R2-29: a clean restore holds every live job that could reach an external effect the lost device may already have performed',
    edits: [{ file: `${STORAGE}/resilience.js`, search: 'const held = effectCapableLiveJobs(ctx).filter((jobId) => txHoldForReconciliation(ctx, jobId, RESTORE_HOLD_CODE));', replace: 'const held = [];', expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-restore-hold-left-to-operator',
    gate: 'R2 integration: a job held by a restore before it ever ran is an Employee\'s governed work — surfaced to and decided by the Founder, never the C1 operator',
    edits: [{ file: `${STORAGE}/governance.js`, search: "OR EXISTS (SELECT 1 FROM work_items gw WHERE gw.id = j.work_item_id AND gw.owner_ref GLOB 'employee:*'))", replace: ')', expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-existing-company-migrated-at-open',
    gate: 'R2-30: an existing Company with pending migrations is never migrated live at open (safe-upgrade only)',
    edits: [{ file: `${STORAGE}/store.js`, search: 'refuseExistingCompany: options.liveSchemaUpdate !== true,', replace: 'refuseExistingCompany: false,', expectedCount: 1 }],
    runs: [RES],
  },
  {
    id: 'c6-start-skips-safe-upgrade',
    gate: 'R2-30: the runtime upgrades an existing Company through the safe-upgrade lifecycle before opening it',
    edits: [{ file: `${RT}/runtime.js`, search: "if (!isQandeelError(error, 'SCHEMA_UPDATE_REQUIRED'))", replace: 'if (true)', expectedCount: 1 }],
    runs: [SIGNAL],
  },
  {
    id: 'c6-maintenance-ignores-open-connection',
    gate: 'm-22: maintenance refuses while another connection holds the database open (a Windows restore could not replace it)',
    edits: [{ file: `${STORAGE}/maintenance.js`, search: 'assertDatabaseNotInUse(layout.databasePath);', replace: '/* mutation: in-use preflight removed */', expectedCount: 2 }],
    runs: [RES],
  },
  {
    id: 'c6-rollback-discards-post-update-work',
    gate: 'R2-31: a rollback that would discard post-activation work is refused unless the operator explicitly acknowledges it',
    edits: [{ file: `${STORAGE}/maintenance.js`, search: 'if (exists && !acknowledged) {', replace: 'if (false) {', expectedCount: 1 }],
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
    edits: [{ file: `${STORAGE}/outcome-core.js`, search: "if (!['REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'].includes(w.state))\n", replace: 'if (false)\n', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-external-outcome-invented',
    gate: 'external outcomes are unavailable until a governed source exists (C7); none is accepted as evidence',
    edits: [{ file: `${STORAGE}/outcome-core.js`, search: "if (classes.includes('EXTERNAL_OUTCOME') && !EXTERNAL_OUTCOMES_AVAILABLE)\n", replace: 'if (false)\n', expectedCount: 1 }],
    runs: [STORE, FREE],
  },
  // --- R2 (cluster K4): C6 distinguishes productive learning from repeated activity -----------------------------
  {
    id: 'c6-recovered-failure-is-the-cause',
    gate: 'a failure the work recovered from (a retry succeeded) is never the primary cause of the Employee\'s merits failure (R2-13)',
    edits: [{ file: `${STORAGE}/improvement-core.js`, search: 'unrecoveredRuns.has(runId) || !runs.some', replace: 'true || !runs.some', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-work-item-counted-per-definition',
    gate: 'one Work Item is one unit of evidence: only its latest live evaluation speaks for it in profiles, reports, economics and health (R2-14)',
    edits: [{ file: `${STORAGE}/improvement-core.js`, search: 'AND NOT EXISTS (SELECT 1 FROM evaluation_results n WHERE n.work_item_id = e.work_item_id', replace: 'AND NOT EXISTS (SELECT 1 FROM evaluation_results n WHERE 0 AND n.work_item_id = e.work_item_id', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-pre-training-work-counts-as-later',
    gate: 'a learning effect is judged only on work STARTED after the training, never on work evaluated after it (R2-15)',
    edits: [{ file: `${MIND}/improvement.js`, search: 'f.workStartedAt > completedAt', replace: 'f.at > completedAt', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c6-pending-recurrence-ignored',
    gate: 'an adverse follow-up whose cause is not validated keeps the learning effect open (never a final IMPROVEMENT_OBSERVED) (R2-17)',
    edits: [{ file: `${MIND}/improvement.js`, search: "if (usable.some((f) => adverseFollowup(f) && f.attributionState !== 'VALIDATED'))\n", replace: 'if (false)\n', expectedCount: 1 }],
    runs: [KERNEL, STORE],
  },
  {
    id: 'c6-pattern-reuse-evidence-reused',
    gate: 'a pattern is shared only after two verified reuses on pairwise-disjoint evidence (R2-16)',
    edits: [{ file: `${STORAGE}/improvement.js`, search: 'patternExpansionAllowed(target, disjointVerifiedReuses(evidence))', replace: 'patternExpansionAllowed(target, evidence.length)', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-self-reuse-credited',
    gate: 'reusing one\'s own pattern is not a System Contribution; only another Employee\'s verified reuse is (R2-16)',
    edits: [{ file: `${STORAGE}/improvement.js`, search: 'AND i.employee_id <> l.employee_id', replace: '', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-pending-adverse-reads-clean',
    gate: 'adverse evidence whose cause is pending holds readiness and is disclosed, never read as a clean profile (R2-18)',
    edits: [{ file: `${MIND}/performance.js`, search: "? ['ADVERSE_EVIDENCE_PENDING_ATTRIBUTION'] : []", replace: '? [] : []', expectedCount: 1 }],
    runs: [KERNEL],
  },
  {
    id: 'c6-disputed-cause-dead-end',
    gate: 'a pool judge\'s dispute of a proposed cause reaches the Founder (escalation), never a terminal rejection that leaves the failure unattributed (R2-18)',
    edits: [{ file: `${STORAGE}/improvement.js`, search: "if (decision === 'REJECT' && ja.subjectKind === 'ATTRIBUTION') {", replace: 'if (false) {', expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6-decided-finding-silences-recurrence',
    gate: 'a problem recurring after its systemic finding was ADDRESSED / REJECTED opens a new linked finding (R2-19)',
    edits: [{ file: `${STORAGE}/improvement.js`, search: 'if (c.evidenceRefs.every((r) => seen.has(r)))\n', replace: 'if (true)\n', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-retraining-exhaustion-swallowed',
    gate: 'another Employee\'s exhausted retraining merges into the open systemic candidate, never swallowed (R2-19)',
    edits: [{ file: `${STORAGE}/improvement.js`, search: "if (origin === 'RETRAINING_EXHAUSTED') {", replace: 'if (false) {', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-billed-cost-as-economic',
    gate: 'C6 cost is the economic cost the budget ledger charges; a subscription / free route is not free work (R2-20)',
    edits: [{ file: `${STORAGE}/improvement-core.js`, search: 'const m = n(u.economic_micros);', replace: 'const m = n(u.billed_micros);', expectedCount: 1 }],
    runs: [STORE],
  },
  {
    id: 'c6-zero-cost-efficient',
    gate: 'work with no recorded cost earns no EFFICIENCY verdict (m-31)',
    edits: [{ file: `${MIND}/evaluation.js`, search: 'if (ev.cost.productiveMicros + overhead === 0)\n', replace: 'if (false)\n', expectedCount: 1 }],
    runs: [KERNEL],
  },
  // --- C6-R1: the Founder is not the operational bottleneck, and judgment never becomes execution authority ---
  {
    id: 'c6r1-ordinary-outcome-founder-only',
    gate: 'an ordinary Work Item whose plan delegates judgment is verified, attributed and learned from by the Review Pool without the Founder',
    edits: [{ file: `${GOV}/review.js`, search: "return { judge: 'REVIEW_POOL', reason: 'PLAN_DELEGATES_JUDGMENT' };", replace: "return { judge: 'FOUNDER', reason: 'PLAN_DELEGATES_JUDGMENT' };", expectedCount: 1 }],
    runs: [JUDGE_KERNEL, FREE],
  },
  {
    id: 'c6r1-r4-judged-by-pool',
    gate: 'R4 stays Founder-only: no Review Pool judgment of R4 work, whatever its plan says',
    edits: [{ file: `${GOV}/review.js`, search: "if (s.risk === 'R4')\n        return { judge: 'FOUNDER', reason: 'R4_FOUNDER_ONLY' };", replace: "if (false)\n        return { judge: 'FOUNDER', reason: 'R4_FOUNDER_ONLY' };", expectedCount: 1 }],
    runs: [JUDGE_KERNEL],
  },
  {
    id: 'c6r1-founder-key-pool-judgment',
    gate: 'a plan that reserves a FOUNDER key keeps Founder judgment (the pool never stands in for it)',
    edits: [{ file: `${GOV}/review.js`, search: "if (judgment === 'REVIEW_POOL' && keys.some((k) => k.kind === 'FOUNDER'))", replace: 'if (false)', expectedCount: 1 }],
    runs: [JUDGE_KERNEL, FREE],
  },
  {
    id: 'c6r1-outcome-conflict-averaged',
    gate: 'review keys that disagree on an outcome are never averaged into a verdict (INCONCLUSIVE, for the Founder)',
    edits: [{ file: `${GOV}/review.js`, search: "return { verdict: 'INCONCLUSIVE', reason: 'OUTCOME_CONFLICT' };", replace: "return { verdict: 'ACHIEVED', reason: 'OUTCOME_CONFLICT' };", expectedCount: 1 }],
    runs: [JUDGE_KERNEL, FREE],
  },
  {
    id: 'c6r1-pass-verifies-without-judgment',
    gate: 'a passed review is not a verified outcome: every key must give its own cited outcome judgment',
    edits: [{ file: `${STORAGE}/review-core.js`, search: 'verdict: (r.verdict ?? null)', replace: "verdict: (r.verdict ?? 'ACHIEVED')", expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6r1-uncertainty-validates',
    gate: 'a pool judge\'s uncertainty escalates to the Founder; it never validates',
    edits: [{ file: `${GOV}/review.js`, search: "return 'ESCALATE';\n}", replace: "return 'VALIDATE';\n}", expectedCount: 1 }],
    runs: [JUDGE_KERNEL, FREE],
  },
  {
    id: 'c6r1-self-judgment',
    gate: 'the executor, its delegation chain and the subject Employee are never drawn as the judge',
    edits: [{ file: `${STORAGE}/review-core.js`, search: 'return [...new Set([...judgmentParties(ctx, workItemId, subjectEmployeeId), ...prior])];', replace: 'return [...new Set([...prior])];', expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6r1-judge-eligibility-not-rechecked',
    gate: 'a judge\'s qualification and independence are re-checked when it decides, not inherited from assignment',
    edits: [{ file: `${STORAGE}/review-core.js`, search: 'return { eligible: v !== null,', replace: 'return { eligible: true,', expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6r1-validated-lesson-shared-company-wide',
    gate: 'validating a lesson never widens its force: team / Department / Company sharing stays separately governed',
    edits: [{ file: `${STORAGE}/memory.js`, search: 'if (!requiresIndependentReview(target)) {', replace: 'if (true) {', expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6r1-judgment-budget-inflated',
    gate: 'a review / judgment Work Item consumes only the plan\'s pre-authorized review budget (a ceiling, never a target)',
    edits: [{ file: `${STORAGE}/review-core.js`, search: "{ money: plan.reviewBudgetMoney, tokens: plan.reviewBudgetTokens }, SYSTEM_REVIEW_REF, 'judgment.assignment'", replace: "{ money: plan.reviewBudgetMoney * 2, tokens: plan.reviewBudgetTokens * 2 }, SYSTEM_REVIEW_REF, 'judgment.assignment'", expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6r1-judgment-raises-budget',
    gate: 'a judgment changes the judged subject only — never a budget cap, grant, approval, route or seat',
    edits: [{ file: `${STORAGE}/improvement.js`, search: "appendAudit(ctx, 'judgment.decided'", // The injected write is assembled at run time (see c6-recommendation-mutates-authority).
    replace: `ctx.db.run([${JSON.stringify('UPDATE')}, 'budgets', "SET cap_money = cap_money + 1, version = version + 1 WHERE scope = 'EMPLOYEE'"].join(' ')); appendAudit(ctx, 'judgment.decided'`, expectedCount: 1 }],
    runs: [FREE],
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
  // R2 K1 (docs/R2_FULL_STRONG_V1_INDEPENDENT_REVIEW_REPORT.md §8): pool judges.
  {
    id: 'c6r2-lesson-judge-drawn-before-evidence',
    gate: 'R2-09: every LESSON judge draw (refill, recovery sweep, release, reassignment) passes the lesson evidence gate',
    edits: [{ file: `${STORAGE}/review-core.js`, search: 'return lessonJudgeDraw !== null && lessonJudgeDraw(ctx, s.subjectId) !== null;', replace: 'return assignJudge(ctx, { ...s, lessonEvidenceReady: true }) !== null;', expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6r2-judge-rubric-hold-not-rechecked',
    gate: 'R2-08: a RUBRIC Quality Hold refuses a pool judge at the decision boundary (the shared eligibility predicate)',
    edits: [{ file: `${STORAGE}/review-core.js`, search: "OR (h.target_kind = 'RUBRIC' AND ? IS NOT NULL AND h.target_ref = ?)", replace: 'OR (0 AND ? IS NOT NULL AND h.target_ref = ?)', expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6r2-withdrawn-judge-excluded-forever',
    gate: 'R2-07 / m-12: a judge withdrawn for a transient reason (a lifted hold) may judge the subject again',
    edits: [{ file: `${STORAGE}/review-core.js`, search: "(state IN ('ASSIGNED', 'DECIDED', 'ESCALATED') OR reason_code = 'JUDGMENT_WORK_ENDED')", replace: '(1)', expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6r2-judgment-survives-qualification',
    gate: 'm-15: a suspended / revoked qualification withdraws its open judgments, not only its review keys',
    edits: [{ file: `${STORAGE}/review.js`, search: 'withdrawJudgment(ctx, ja, `REVIEWER_${to}`);', replace: 'void 0;', expectedCount: 1 }],
    runs: [FREE],
  },
  {
    id: 'c6r2-ended-judge-keeps-judgment',
    gate: 'm-11: a judge Work Item that ends without its decision releases the judgment in the same transaction',
    edits: [{ file: `${STORAGE}/review-core.js`, search: '    releaseAbandonedJudgment(ctx, workItemId);\n}', replace: '}', expectedCount: 1 }],
    runs: [FREE],
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
