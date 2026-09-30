# R2 — Full Strong-v1 Independent Review Report

**Status:** IN REVIEW — **initial findings FROZEN** (this section set §1–§11 is the frozen register; it is
committed before any Product / runtime code changes). Remediation, the fresh re-review and closure are
recorded in later sections as they happen; the identity and root cause of every frozen finding stay
traceable.

R2 reviews C1–C6 as **one Company system**: the seams between stages, not only the parts. It is a review
and defect-remediation stage, not a feature stage. No C7 functionality, App telemetry, Pilot dashboard or
new Product policy is introduced.

## 1. Baseline (repository truth gate)

| Check | Result |
|---|---|
| Repository | `allamqandeel/qandeel-company` |
| `origin/main` at R2 start | `b4f91ca3af883907b3c42567a0c757587bec0391` = the expected baseline (fetched with GitHub Desktop's signed Git) |
| Tree | `e99e18ef1d1f64bf1db5b2ba758eb703d828d78d` = PR #11 head `b282f7d8…` tree (`gh api`) |
| C6 PR #11 | MERGED 2026-09-30T07:38:38Z from exact head `b282f7d862709839d6b4d91344db5f2d5b93e753` |
| Exact-head CI | run #84 (`36683740654`) SUCCESS — full Windows + Ubuntu matrix (static, tests, 18 mutation shards, acceptances, `quality-gate`) |
| Post-merge CI | run #85 (`36684884466`, push on `b4f91ca`) SUCCESS — **fast-integrity only** (classify, `integrity` ×2, `quality-gate`; full matrix skipped). Not visible when the brief was prepared; recorded as observed, not as a second full proof |
| Toolchain | Node `v24.19.0`, npm `11.17.0` (engines `>=24.12 <25`, `>=11.6 <12`); `npm ci` 0 vulnerabilities |
| Working tree | clean; branch `review/r2-full-strong-v1` from exact `origin/main` |
| Lifecycle sync | commit `9fb5304`: `docs/C6_CLOSURE_RECORD.md`; implementation map C5 / C6 CLOSED / MERGED / CANONICAL, R2 IN REVIEW; verifier 69/69 |

## 2. Authority read

Canonical baseline (Rules A / B / C), Implementation Authority Rules, BOUNDARIES, CLAUDE.md C1 invariants,
the full DECISION_LOG (C1–C6, R1, C6-R1), the R1 report and closure record, C1–C6 implementation reports and
closure records, and — per review angle, in full — Stage 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13 (closure,
D13 register / handoff), 14 (closure, D14), 15 (closure, D15), 17 (closure, D17 register / handoff), the
Founding Constitution sections on Founder sovereignty and Title ≠ Authority. The Stage 16 source remains
missing and was not reconstructed. Implementation reports, closure records, green CI and test names were
treated as **claims, not proof**.

## 3. G1 — Skills

| Skill | Result | Effect |
|---|---|---|
| `code-review` | **Used, `max`** (the strongest level launchable from this session; `ultra` is user-triggered / billed and cannot be launched by the executor) on the whole-tree path target `packages scripts` | Its finder angles were mapped onto the R2 review map: 11 independent finder agents (R2-A/H, B, C, D, E, F/G, I, J/K/L, M, N, O) → 6 independent verifiers (1-vote, CONFIRMED / PLAUSIBLE / REFUTED, re-running every probe) → 1 fresh gap sweep. Cleanup angles (reuse / simplification / efficiency) are R2 anti-scope except where they threaten correctness or cause pathological cost; they were folded into the finders |
| `security-review` | **Attempted — failed at launch**: `Shell command failed for pattern "!\`git diff origin/HEAD...\`"`. The skill shells out through the Bash tool, which exits 2 on every command on this host (known Founder-host quirk). The environment was **not** changed to force it | Replaced by the explicit manual R2-N security / privacy track (§5, R2-N): Rules A / B / C trace of every audit / event / log site added in C4–C6, loopback / auth / CSRF / DNS-rebinding, path confinement, SQL construction, secret detection boundaries, backup crypto, test seams, CLAUDE.md conventions — empirical probes, not reading only |
| All others (UI, animation, React Native, media, docs / office, dataviz, claude-api, workflow-authoring, simplify) | Not used | Not relevant: R2 changes no visual surface design, draws no chart, makes no model call, and forbids cleanup-only work |

## 4. Review method

1. **Finder phase (no fixes).** Eleven independent adversarial reviewers, one per R2 dimension, each reading
   the authority for its angle, the enforcing code, the SQL triggers, and **reproducing every BLOCKER / MAJOR
   candidate with an executable probe** (git-ignored `tmp/r2-probes/<angle>/`; company workspaces outside
   the git tree because the store refuses one inside it — `UNSAFE_WORKSPACE`). Each also owned a slice of the
   38 mandatory cross-stage scenarios.
2. **Verification phase.** Six independent verifiers, grouped by suspected root cause, re-ran every probe,
   read the code themselves, tried to refute each candidate, settled severity against the taxonomy, and
   designed the smallest root-cause correction boundary.
3. **Gap sweep.** One fresh reviewer given the verified list, looking only for defects not on it (§8.4).
4. **Deduplication** by root cause into the register below (§8). Duplicate reports by independent finders
   are recorded as corroboration (e.g. the BLOCKER was found independently by R2-A/H and R2-B; the budget
   wake defect by R2-C and R2-D; the lesson-judge gate bypass by R2-C and R2-F/G; confirm atomicity by R2-D
   and R2-I).
5. Focused probes and single test files only — no full CI during the review (the baseline tree was proven by
   run #84).

**Incident (disclosed).** During the proof-system experiments (R2-O), one scripted write used a relative
path that .NET resolved against the real repository instead of the disposable copy: for ~10–15 minutes
`packages/governance/src/authority.ts` had its R4 `assertApprover` line commented out, and
`scripts/verify-bootstrap.mjs` was overwritten and restored. Both were restored by the agent; I verified
independently that `git hash-object` of both files equals the `HEAD` blobs, the tree is clean, and the
governance `dist` (built 10:50) predates the source touch (11:05) — **no probe ran against damaged code and
nothing damaged was committed.** Later experiments used absolute paths only.

## 5. Review coverage

| Angle | Scope read and probed |
|---|---|
| R2-A / H | Identity / lifecycle / organization; communication / delegation — 0007 / 0008, `org-writes`, `org-core`, `organization`, `governed-writes` waits, `review-core`, `work-core`, `goals`, `communications`; runtime begin / `openHandoffs` |
| R2-B | Authority / risk / Founder sovereignty — governance `authority` / `review` / `tools`; storage approvals, grants, fingerprints, review plans, judgment assignments; 0004 / 0008 / 0010 triggers; Command Center APPROVAL_DECIDE |
| R2-C | Money / routing — `model-runtime`, `employee-task`, governance routing / economics / providers, budgets / reservations / settle / release / charged exclusions, review / judge funding, C6 cost evidence |
| R2-D | Work OS / concurrency / crash / restart — runtime pump / heartbeat / recovery, `queue`, `runtime-authority`, every C4–C6 wait state and its wake; multiprocess suite 6/6 |
| R2-E | Provider / tool boundary — provider boundary (R1-09) consumers, tool executor, `txToolIntent` / `txToolResult`, secret detector, review subject construction |
| R2-F / G | Memory / canonical truth / knowledge; Skills / Academy / certification / Review Pool — `memory`, `mind-core`, `mind-writes`, context assembly, academy, review selection / decision re-check / refill / sweep / judges |
| R2-I | Founder Command Center — API, auth, listener, NL classifier, previews / confirm, attention, universe projection, UI refresh / SSE; real loopback surface probed over HTTP / SSE |
| R2-J / K / L | Evaluation / attribution / performance; learning; reporting — mind kernel (`evaluation`, `performance`, `improvement`, `reporting`), storage `improvement*`, every 0010 trigger |
| R2-M | Resilience — `backup`, `resilience`, `maintenance`, `update-hold`, `migrations`, `store` open path, runtime recovery / CLI; 8 probes incl. packaging memory |
| R2-N | Security / privacy / secrets (replaces `security-review`) + CLAUDE.md conventions |
| R2-O | Proof system — CI workflow / classifier / post-merge / quality gate, runner, verifier (69 rules + self-tests), all mutation scripts, acceptances, browser smoke; 3 disposable copies for damage experiments |

## 6. Mandatory cross-stage scenarios (§9 of the brief)

PASS = held under probe / test / exact source; FAIL → finding id; PG = Product gap.

| # | Scenario | Result |
|---|---|---|
| 1 | Identity across model / provider / session / runtime replacement | PASS (`governed-runtime` test; no model / provider identity column in 0007–0010) |
| 2 | Certification lost mid-work | PASS (decision-time certification re-check; executor gated at run, model call, tool intent) |
| 3 | Role changes while work / review / judgment pending | PASS on authority; MINOR liveness residuals (m-03, m-04, m-11) |
| 4 | Grant revoked after planning, before action | PASS (`txToolIntent` re-reads grants in the intent transaction; no await before the driver) |
| 5 | Approval decided while run CLAIMED | PASS (R1-06 settle re-check; approve → EXECUTE, reject → DENIED) |
| 6 | Budget cap changes while waiting / claimed | **FAIL** → R2-03, R2-06 (m-05) |
| 7 | Two workers race | PASS (fenced conditional claim; multiprocess 6/6) |
| 8 | Reviewers / judges race or become ineligible mid-decision | **FAIL** → R2-07, R2-08 |
| 9 | Review passes, outcome evidence missing | PASS |
| 10 | Reviewers disagree | PASS (INCONCLUSIVE, never averaged) — but its Founder decision has no production entry → R2-21 |
| 11 | Employee validates own attribution / lesson / outcome | PASS (direct and forged paths refused); reciprocal collusion recorded (m-30) |
| 12 | Director title without reviewer qualification | PASS for review / judging; goal derivation → AC-01 |
| 13 | R3 reviewed, no Founder execution approval | PASS |
| 14 | R4 with pool-delegated-looking plan | PASS (kernel, trigger, review resolution) |
| 15 | Plausible but false reflection | PASS for mistakes; patterns → R2-16 |
| 16 | Tool failure with reasonable Employee judgment | PASS for an unrecovered tool failure; **FAIL** inverse → R2-13; boundary → R2-10 |
| 17 | Provider failure + storage contention | Accounting PASS (one hold, one settle, invariants clean); run record **FAIL** → R2-12; m-06 |
| 18 | One lucky success attempts Company-wide promotion | **FAIL** → R2-14, R2-16 |
| 19 | Same mistake repeats after lesson + retraining | **FAIL** → R2-17, R2-19 |
| 20 | Canonical truth changes after a validated personal lesson | Claim-keyed lessons invalidated (PASS); claim-free C6 lessons → PG-05 |
| 21 | Systemic finding credit (Employee vs system) | PASS |
| 22 | Report sees insufficient / conflicting evidence | PASS; m-28 |
| 23 | "Use stronger model / spend more" recommendation | PASS (text codes only; no budget / route / authority write outside Founder paths) |
| 24 | Founder surface unavailable, ordinary work | PASS (c6-founder-free 5/5; probes ran Founder-free) |
| 25 | Founder unavailable where truly required | Blocking holds; **FAIL** on surfacing / deciding → R2-01, R2-21, R2-22, R2-25 |
| 26 | Restart while review / judgment / learning pending | **FAIL** partial → R2-02, R2-26; m-11 |
| 27 | Restart after uncertain external action | Runtime PASS (RECONCILIATION_REQUIRED, held); restore **FAIL** → R2-29 |
| 28 | Backup with work / review state; restore lineage | PASS (whole-DB snapshot; lineage and recorded holds kept) |
| 29 | Tampered portable backup | PASS (tag / header / truncation / wrong passphrase → BACKUP_INTEGRITY); m-24 |
| 30 | Failed schema update | **FAIL** → R2-30, R2-31; m-22 |
| 31 | C5 projection / attention after restore / restart | Server PASS (no refresh storm; zero-delta silent); browser m-34 |
| 32 | Private App content at a Company boundary | PASS (no App import; loopback-only network; EXTERNAL_OUTCOME refused) |
| 33 | EXTERNAL_OUTCOME before C7 | PASS (kernel, outcome-core, CHECKs, verifier flag rule) |
| 34 | Cheap eligible route vs expensive | PASS |
| 35 | Cheap route unqualified | PASS (NOT_QUALIFIED / TASK_CLASS / D3 / reasoning-class refusals re-checked in `txReserve`) |
| 36 | Reviewer / judge Work Items cannot widen budgets / grants / tools / routes / risk | PASS (R1, no plan, reviewer's own grants, allocation within its envelope) — note R2-01 lets the executor pick the plan's review budget |
| 37 | Restored / restarted Company duplicates no external side effect | **FAIL** → R2-29 |
| 38 | Damage experiments on the proof system | **FAIL** partially → R2-32, R2-33 (§7) |

## 7. Proof-system damage experiments (scenario #38, disposable copies)

| Damage | Expected catcher | Observed |
|---|---|---|
| R4 `assertApprover` refusal removed (governance) | governance kernel | CAUGHT (C4-PROOF R4 Founder-only) |
| Fencing-token check removed (`queue`) | `queue.test` | CAUGHT |
| C6 EXTERNAL_OUTCOME refusal disabled | c6 storage proofs | CAUGHT (2 failures) |
| `judgment_assignments_independent` trigger neutered + re-pinned | c6-founder-free datastore proof | **NOT CAUGHT** — storage 307/307, verifier 69/69, c4 / c5 / c6 acceptances PASS → R2-32, R2-33 |
| Released migration 0010 edited + re-pinned | `migrations-immutable` / frozen list | **NOT CAUGHT** → R2-33 |
| Verifier sqlite rule disabled (`false && …`) | verifier self-test | CAUGHT (exit 2) |
| Verifier sqlite / network rule scope narrowed | verifier self-test | NOT CAUGHT → m-37 |
| `process.getBuiltinModule('node:sqlite' / 'node:net')`, template `import()` | verifier + ESLint | NOT CAUGHT → m-37 |
| Mutation `replace` turned into a syntax error | mutation oracle | NOT CAUGHT ("PASS") → m-38 |
| Test file with no tests / `test.skip` / package without tests | runner | CAUGHT |
| `process.exit(0)` mid-file before a failing proof | runner | NOT CAUGHT → m-39 |

## 8. Findings register (FROZEN)

Severity per the brief's taxonomy. Every BLOCKER / MAJOR was reproduced by an executable probe (path given)
or, where stated, exact source proof, and independently re-run by a verifier. "Correction boundary" is the
proposed root-cause fix, not yet applied. Probe paths are relative to the git-ignored `tmp/r2-probes/`.

### 8.1 BLOCKER

| ID | Finding | Root-cause family | Reproduction | Affected contracts | Correction boundary |
|---|---|---|---|---|---|
| **R2-01** | **The executor can re-design its own Review Plan after execution.** Holding the ordinary delegable `org.review.plan` capability (org grants are always resource `*`), the Employee executing a Work Item supersedes that item's plan (v2+) from inside its own run: it drops a Founder-reserved key, flips `operational_judgment` FOUNDER → REVIEW_POOL (the pool then verifies the outcome with no Founder involvement), relaxes independence, and — because a REWORK on an exact action is looked up only under the *active* plan — re-presents an action that review rejected, drawing a fresh review ("reviewer shopping") until it passes and executes. | Review-plan authority not separated from execution: `review.plan.declare` accepts `target.ownerRef === actor` (`org-writes.ts:~394`); 0008's plan-before-execution trigger covers `version = 1` only; `txDeclarePlan` supersedes without any non-weakening rule; `actionReviewGate` REWORK scoped `AND plan_id = ?` (`review-core.ts:~638`) | `authority/a-plan-self-supersede.mjs` (v1 `[SPECIALIST,FOUNDER]`/FOUNDER → v2 `[SPECIALIST]`/REVIEW_POOL by `employee:`; request1 STALE; `OUTCOME_VERIFIED` by REVIEW_POOL; Founder never acted); `authority/c-reviewer-shopping.mjs` (DENIED REVIEW_REJECTED → re-declare → REVIEW_PENDING → EXECUTE); `r2-ah/p5-executor-replans-own-review.mjs`. Found independently by R2-A/H and R2-B | Stage 11 §1 / §3 / §10 / §18; Stage 3 no self-escalation, independence by authority; D-C4-05 ("a rejected exact action stays rejected"); D-C6-10 (a FOUNDER key reserves Founder judgment) | C4 review-plan act: the Work Item's owner may declare only version 1 before its first run, never supersede; REWORK on an exact action scoped by (Work Item, action fingerprint), not plan; defence-in-depth trigger in a new migration (0001–0010 immutable). Delegator / Founder supersession stays as designed (PG-01 for whether a non-Founder may *weaken* a plan). Mutations c4 + c6 |

### 8.2 MAJOR

| ID | Finding | Root-cause family | Reproduction | Correction boundary |
|---|---|---|---|---|
| R2-02 | An executor waiting `AWAITING_INDEPENDENT_REVIEW` is stranded forever when its ACTION review request goes STALE (plan superseded / newly applied): no wake, no restart sweep, invisible in health | **Wait-resume predicates incomplete** (R1-06 lost-wake family recurring in C4) | `r2-d/p1-plan-supersede-stuck.test.mjs` (`wakeGen 22 -> 22`; still WAITING after `reconcileOrganization`) | Targeted wake in `txDeclarePlan` / plan-superseded decision branch; restart sweep clause for ACTION waits (c4) |
| R2-03 | A Work Item parked `BUDGET_EXHAUSTED` by a sibling's transient worst-case reservation is never woken when the headroom returns (settle / release / Founder reconcile wake nothing; only a cap raise does); survives restart; health shows headroom. Also a cap raise wakes only the first 1000 Work Item leaves (limit before filter; folded, MINOR on its own) | Same family | `r2-d/p3-budget-transient-park.test.mjs`, `r2c/p1-budget-wake.mjs` (still WAITING after restart); `r2c/p3-raise-wake-limit.mjs` (N=1005 stays WAITING) | One waiter-driven, headroom-gated budget wake used by settle, release, reconcile, cap raise, the WAIT-settle re-check and one startup pass (r1 / c2) |
| R2-04 | An ESCALATED (or CLARIFICATION_REQUESTED) handoff makes the delegator's job re-queue on every WAIT settle — one paid model call per re-run — until `PERMANENT_FAILURE MAX_TURNS`; the escalated child lives on under a FAILED parent | Same family: two definitions of "open handoff" (settle re-check `OFFERED/ACCEPTED` vs processor / `OPEN_DELEGATION`) | `r2-ah/p1-escalation-spin.mjs` (4 consecutive re-runs QUEUED with `openHandoffs()=1`) | One open-handoff set shared by re-check, processor and trigger; a delegator's own pending clarification continues the model turn instead of parking (c4) |
| R2-05 | A delegation closes COMPLETED when the child only finishes execution (WAITING_REVIEW); the delegator completes on unreviewed work, and a later review FAIL / rework never reaches it | Completed ≠ Reviewed conflated at the C4 delegation trigger (same family as R1 N-WORK) | `r2-ah/p8-handoff-completed-before-review.mjs` (child FAIL → READY; delegation / parent stay COMPLETED) | New migration recreating `work_delegations_follow_child`: a review-required child closes its delegation only at REVIEWED or later (D-C1-21); repair open rows (c4) |
| R2-06 | The Founder cannot lower an Employee / Department / Work Item cap below the largest cap of **any** historical child (finished Work Items, RUN budgets defaulting to the full Work Item cap, CLOSED envelopes left by transfers) | Budget floor counts dead children as live | `r2c/p6-cap-lower-blocked.mjs` (lower 5 000 000 → 500 000 with 403 spent: REFUSED) | Child floor over children that can still spend; "never below reserved + spent" kept; decision-log note (c2) |
| R2-07 | The MANAGER review key is structurally unsatisfiable in common configurations: the decision re-check applies the plan's department exclusion to the manager (selection exempts it); a withdrawn reviewer counts as "prior" forever; greedy key order lets the manager take the SPECIALIST key | **Review-eligibility predicate divergence** (selection ≠ decision re-check ≠ judge re-check) + exclusion-history semantics | `r2-fg/p1*.mjs` (manager PASS → REVIEWER_NOT_ELIGIBLE, key WITHDRAWN, WAITING_REVIEW forever); `r2-fg/p2*.mjs` | One shared eligibility predicate; "prior" = ASSIGNED / DECIDED only; MANAGER / FOUNDER keys filled before SPECIALIST (c4) |
| R2-08 | A RUBRIC Quality Hold (and a closed reviewer envelope) is not re-checked at decision time for reviews or judges: under an ACTIVE rubric hold a review still SATISFIES and the pool verifies the outcome (OUTCOME_VERIFIED) — contradicting the code's own "reliance stops now" | Same family (R1-12 re-check family) | `r2-fg/p4*.mjs` (RECORDED SATISFIED → OUTCOME_VERIFIED under the hold; control subject QUALITY_HOLD) | Same shared predicate incl. RUBRIC hold + OPEN envelope; judge capacity counts open judgments (c4 / c6) |
| R2-09 | Lesson judges are drawn before the lesson's independent evidence exists: pool refill, abandoned-judgment release and the REVIEWER_NOT_ELIGIBLE reassign call `assignJudge` directly, bypassing the gate in `txRequestLessonJudgment` — each sweep funds a new judge Work Item that stands down, and a judge FAIL **rejects** the lesson before evidence exists | Gate on one path, bypass on sibling paths | `r2-fg/p6*.mjs` (sweeps 1–3 each draw and fund a judge; FAIL → lesson REJECTED with no attribution). Found by R2-C and R2-F/G | Every LESSON judge draw through the gated function (c6) |
| R2-10 | The tool driver's answer is read many times with no boundary snapshot (the R1-09 provider-boundary hardening was never applied to tools): an `ok` that flips between reads re-executes an UNSAFE effect under one idempotency key and releases its money; a result that changes between the secret guard and serialization stores secret material | **Tool-driver answer boundary** (R1-09 family) | `r2-e/probe-tool-boundary.mjs` (S1: UNSAFE effect ×3, reservations RELEASED; S4: `{"password":…}` stored), `verify-e/probe-ok-flip.mjs`. Latent (only fake drivers today) but on the C7 path | `tool-boundary.ts` mirroring `provider-boundary.ts` (read once, frozen plain data, code validated incl. secret check); storage guards the serialized value (r1) |
| R2-11 | The independent ACTION reviewer approves arguments it never saw: arguments are cut at 3000 chars with no marker (validation allows 8192; sorted keys drop the late ones), the whole subject is cut again at 11 000, and every refill / reassignment path rebuilds the subject **without** arguments; the PASS binds the full-argument fingerprint. Secret-shaped arguments are also copied into the reviewer's Work Item input | **Action-review subject not durable / single-sourced** | `r2-e/probe-review-args.mjs` (hidden `recipient` executed), `verify-e/probe-review-refill.mjs` (refill subject has no arguments), `verify-e/probe-review-secret-arg.mjs` | Durable subject written once at request creation (new migration), read by every fill; never truncated (fail closed); secret-shaped subject refused before any request is created (c4 / r1) |
| R2-12 | Run failure codes blame the PROVIDER for local and configuration causes (local settlement contention, missing route policy, route refusal, abort all become `PROVIDER_UNAVAILABLE`); several emitted codes are in no C6 family and several C6 codes are never emitted — C6 then proposes PROVIDER as PRIMARY with HIGH confidence | **C2 run-fact → C6 cause vocabulary has no shared contract** | `r2-e/probe-attrib.mjs` (P1 STORAGE_BUSY, P2 no route policy → `PROVIDER_UNAVAILABLE`) | One run-failure vocabulary module used by the runtime and C6; local failures distinguished; exhaustiveness proof (r1 / c6) |
| R2-13 | A recovered transient tool failure (retry succeeded) becomes the PRIMARY HIGH-confidence cause of the Employee's merits failure (reviewer FAIL, NOT_ACHIEVED); a pool judge can only validate the wrong cause or reject it into a dead end | Same family (all-runs failure counting; first system signal suppresses the Employee cause) | `r2-jkl/p8*.mjs` (`TOOL / HIGH / employeeAccountable false`; after REJECT: no attribution, pending forever) | Recovered vs unrecovered failures separated in evidence; recovered causes at most CONTRIBUTING (c6) |
| R2-14 | Each eval-definition **version** keeps its own live evaluation, so one Work Item is counted N times: one lucky success re-evaluated under v2 / v3 becomes SUFFICIENT / STRONG, capability DEMONSTRATED, 3 qualified outcomes | **C6 evidence identity / time** (evaluation row treated as the unit of work) | `r2-jkl/p1*.mjs` | One live evaluation per Work Item (write supersedes across versions of a code; reads dedupe) (c6) |
| R2-15 | Work done **before** retraining counts as "later comparable evidence" (evaluation time used as work time); a late verification or any re-evaluation produces a final false IMPROVEMENT_OBSERVED (or, re-evaluating the failing item, a false NO_IMPROVEMENT) | Same family | `r2-jkl/p2*.mjs` (`newWorkAfterTraining 0` → IMPROVEMENT_OBSERVED, final) | Evidence carries Work Item work time; effect assessment admits only work started after training; baseline by Work Item (c6) |
| R2-16 | "Two verified reuses" of a successful pattern can be the author's own next two successes, both assessed on the **same** evidence: the Company-promotion gate passes and SYSTEM_CONTRIBUTION credit accrues | Same family (same evidence credited N times) | `r2-jkl/p6*.mjs` (`same evidence for both reuses: true` → promotion APPROVED, SYSTEM_CONTRIBUTION STRONG) | Reuses need pairwise-disjoint evidence; one open PATTERN_REUSE per (lesson, Employee); gate trigger replaced in a new migration. Author self-reuse question → PG-03 (c6) |
| R2-17 | A recurrence whose attribution is still PROPOSED is invisible to the learning-effect assessment → IMPROVEMENT_OBSERVED, which is **final**; later validation changes nothing; the retraining bound never trips, no escalation | **Unvalidated adverse evidence treated as absent** | `r2-jkl/p2*.mjs` "P3" (IMPROVEMENT_OBSERVED while recurrence pending; unchanged after validation) | Adverse follow-up without a decided attribution holds the assessment non-final (c6) |
| R2-18 | Readiness / level / trend ignore negatives that are unattributed, PROPOSED or REJECTED (10 successes + 20 later failures → READY_FOR_GREATER_RESPONSIBILITY_REVIEW, and a monthly recommendation hiding the pending evidence); a REJECTED attribution is a dead end (never re-proposed; no Founder act to attribute) | Same family | `r2-jkl/p4*.mjs` (kernel), `r2-jkl/p8*.mjs` (rejected → pending forever) | Pending adverse evidence blocks a READY signal and is disclosed; a rejected adverse outcome reaches the Founder for decision (c6; with R2-21) |
| R2-19 | Once a systemic finding is ADDRESSED or REJECTED the same problem is never raised again (permanent dedup key); a second Employee's retraining exhaustion is swallowed | **Systemic-finding lifecycle** | `r2-jkl/p5*.mjs` (6 more validated failures after ADDRESSED: 0 attention, 0 report claims) | Recurrence after a terminal decision opens a new linked finding counting only evidence after that decision; exhaustion merges into an open candidate (c6) |
| R2-20 | C6 cost evidence uses `billed_micros`, never `economic_micros`: subscription / free routes read as cost 0, EFFICIENCY POSITIVE regardless of spend, cost per qualified outcome 0 — while the budget ledger charges economic cost | **Cost basis at the C2 → C6 seam** | `r2c/p2-c6-billed-cost.mjs` (billed 0 / economic 408 → C6 cost all 0) | Economic cost in the cost buckets, billed carried separately (D13-G.3 / G.8) (c6) |
| R2-21 | Founder-only exception decisions have **no authenticated production entry**: reconciling an uncertain tool effect / held reservation / held job, resolving an escalated review, deciding a systemic finding, an escalated judgment, a pool-INCONCLUSIVE outcome, a lesson / promotion — all fail closed outside a Founder session and no route, intent or CLI opens one for them. Attention even shows some of them with only Show / Dismiss | **Founder exception loop incomplete** (the seam C2 / C4 / C6 assigned to C5) | Exact source proof (routes, `MUTATING_INTENTS`, `#execute`, both CLIs; ~11 of ~103 Founder-authority sites reachable); `c6-acceptance` proves the fail-closed half | Structured-only governed preview intents confirmed through `FounderActionStore` for each decision (new migration widens the intent CHECK); binary rail actions posting structured previews; forms needing values (charge amounts, outcome evidence) stay API-only → PG-04 (c5 / c6) |
| R2-22 | Founder Attention never surfaces uncertain external effects (tool invocations RECONCILIATION_REQUIRED, held jobs / reservations) or escalated required reviews (R4 / reviewer uncertainty) | Same family | Exact source proof (`collectSignals` sources; `material:false` RECONCILIATION_PENDING) | DECISION_REQUEST sources for each, keyed per entity, stable change time; ships with R2-21 (c5) |
| R2-23 | The natural-language GOAL_STATE intent always previews **Activate**: the verb is tested after it was stripped from the argument — "pause / cancel / اوقف / الغ … goal" all preview Activate, and confirming re-activated a PAUSED goal; ACHIEVED is unreachable | **Founder intent resolution loses / widens the stated intent** | `r2-i/p1*.mjs` | Target state derived from the classified verb; unknown verb → no preview (c5) |
| R2-24 | Rail buttons re-serialize structured acts into free text, and an unmatched argument falls back to "the single pending approval" with a default decision: "Approve goal" on a goal titled "Deny competitor entry" previews **rejecting an unrelated R3 approval**; other titles make the button dead; staffing / conflict intents ignore the argument | Same family | `r2-i/p2*.mjs` | Rail buttons post structured previews; a given-but-unmatched argument never falls back (c5) |
| R2-25 | Founder Attention dedups resilience exceptions per failure **class** and keeps a dismissal "until the source resolves": after one dismissal every later failed drill (and a dismissed thread's later URGENT messages) is swallowed; the detail points at the first instance | **Attention identity / dismissal semantics** (D-C5-06 says "until the source *changes*") | `r2-i/p1*.mjs` part B (drill 3 FAIL → `{opened:0}`) | Per-instance keys; a dismissed item reopens when its source changes (c5) |
| R2-26 | `FounderActionStore.confirm` is not atomic: the effect commits in its own transaction(s) and CONFIRMED later; an interrupted confirm leaves the preview in PREVIEW and a retry re-executes (a second Goal; a second delegation), or records FAILED for a decision that was taken; multi-step goal acts commit partially | **Mutation not one transaction** (CLAUDE.md invariant) | `r2-d/p4-confirm-not-atomic.test.mjs` (second confirm → 2 goals). Found by R2-D and R2-I | Whole confirm (check, effect, CONFIRMED, audit) in one `BEGIN IMMEDIATE` through transaction-level boundary functions (c5) |
| R2-27 | A PERSONAL lesson promotion writes a memory directly, bypassing the Memory Write Policy's conflict detection: two contradicting ACTIVE memories on one claim, no conflict row, no CONFLICT_HOLD, the older silently dropped as "higher authority" | **Write path bypassing the governing policy** | `r2-fg/p3*.mjs` (control through the policy opens 2 conflicts) | Promotion opens conflicts through the policy's own mechanism (c3) |
| R2-28 | A second partition of the same physical disk counts as **off-device**: the off-device recovery objective reads satisfied for a copy that dies with the laptop (this host's C: and E: are partitions of one NVMe) | **Failure-domain honesty** | `R2-M/p1-volume.mjs` (`SEPARATE_VOLUME`, `offDevice:true`, no exception) | Only an operator-attested destination satisfies the off-device objective (D-C6-06 `ATTESTED_OFF_DEVICE`) (c6) |
| R2-29 | A clean restore re-executes UNSAFE external effects the lost device already performed after the backup point: work queued / claimed-without-intent at the snapshot is dispatched normally; the report says nothing is pending | **Restore is not treated as an ambiguity boundary** | `R2-M/p2-rpo-gap-duplicate.mjs` (one Work Item → 2 UNSAFE effects; `jobsHeld:0`) | Controlled restore holds every non-terminal job that may reach an external-effect tool for reconciliation (resolved through R2-21's path); report lists held jobs and data age (c6) |
| R2-30 | The ordinary start path applies pending migrations live, bypassing Preflight → Backup → Rehearse → Verify → Activate (no snapshot, no rehearsal, no record, no hold on failure) | **Maintenance lifecycle optional, not structural** | `R2-M/p3-start-migrates.mjs` (v9 → v10 via `start`, `lastMaintenance:null`, 0 backups) | An existing Company with pending migrations is refused at ordinary open and upgraded only through the safe-upgrade lifecycle (the runtime runs it automatically); fresh creation unchanged (c6 / c1) |
| R2-31 | `rollback-update` overwrites the live database with the pre-update snapshot however long after activation, destroying all post-activation state (incl. append-only audit and the maintenance record) with only `{restored:true}` reported | Same family + destructive operation without a retained copy | `R2-M/p5-rollback-loss.mjs` (3 post-activation Work Items NOT_FOUND) | Hold first; retain a pre-rollback snapshot; refuse when post-activation work exists unless explicitly acknowledged; report what was discarded (c6) |

### 8.3 PROOF / VALIDATION DEFECTS (MAJOR — the proof system is falsely green for a real safety invariant)

| ID | Finding | Reproduction | Correction boundary |
|---|---|---|---|
| R2-32 | The datastore proofs of the C6-R1 judge-independence / R4 trigger are vacuous: the forged-insert closures call `createWorkItem` inside `db.immediate`, so a nested-transaction `STORAGE_INVARIANT` is thrown before the INSERT; the generic `code('STORAGE_INVARIANT')` assertion is satisfied. The C6 report's "forged judges … refused by triggers — each backed by a proof" is false for the trigger | Instrumented (`nested transactions are not supported` ×3); trigger neutered + re-pinned in a copy → storage 307/307, verifier 69/69, acceptances PASS (`packages/storage/test/c6-founder-free.test.ts:~252-281`, confirmed by direct reading) | Fixture creates the judge Work Item before the transaction; assert the trigger's own message |
| R2-33 | Released migrations 0007–0010 (C4, C5, C6) are not frozen by content: `FROZEN_MIGRATIONS` lists 0001–0006 only, so editing a released C4–C6 migration and re-pinning it passes every gate (R1-14 recurrence) | Copy: 0010 trigger `WHEN 0` + re-pin → `migrations-immutable` ok, 69/69 (`scripts/verify-bootstrap.mjs:180-187`, confirmed by direct reading) | Extend the frozen list; add R2's own migration when released |

### 8.4 Gap sweep

A fresh reviewer given the verified list (code-review Phase 3) found 7 new candidates. The two MAJOR
candidates were re-run and read independently before the freeze (verification vote: CONFIRMED):

| ID | Finding | Root-cause family | Reproduction | Correction boundary |
|---|---|---|---|---|
| R2-34 | **A failed Academy SIMULATION strands the enrollment in RETRY forever.** After retraining, RETRY → SIMULATION, but the SIMULATION exit accepts *any* evaluated simulation — the old failed one — so it cycles FEEDBACK → RETRY → SIMULATION (12 false stage-history rows per `advance`); once the trainee's retest flips the remediation to RETESTED, RETRY's only exit (`RETEST_READY`) never fires again. The trainee can never reach assessment, certification or activation; withdraw / re-enroll hits the same trap. The ASSESSMENT path has a "retrained" guard; SIMULATION has none | State-machine exit predicate ignores retest provenance (`academy.ts:~264-275`) | `sweep/s3-simulation-retry-stuck.mjs` (re-run: 17 history rows, last 7 cycling; retest PASS → advance ×3 stays RETRY) | SIMULATION exit counts only simulations after the latest retraining; RETRY exits on an evaluated retest (c3) |
| R2-35 | **A material skill update's recertification set is frozen at plan time.** `planUpdate` snapshots the affected passports / certifications; `rolloutUpdate` touches only that snapshot, so a certification issued or a passport opened between plan and rollout keeps the old version VALID / ACTIVE — a FULL recertification is silently bypassed | Stale snapshot used as an authority set (`skill-registry.ts:~373-385, ~412-419`) | `sweep/s5-update-impact-snapshot.mjs` (re-run: impact 0 / 0 at plan; after material FULL rollout the new certification is VALID on v1, passport ACTIVE on v1) | Recompute the affected set inside the rollout transaction (c3) |

MINOR from the sweep (recorded): m-44 shadow work assigned / executed in a FAILED probation epoch is collected
into the next epoch (`academy.ts:~439-457`; `sweep/s4-failed-epoch-shadow-counts.mjs`); m-45 a lease-lost
processor's `ctx.putArtifact` resolves to the job's *current* run and writes under its fence (R1-08 re-key
missed at one call site; no Strong-v1 processor calls it; `sweep/s1-stale-put-artifact.mjs`); m-46 runtime
start marks pending outbox events dispatched before the Command Center subscribes, so a BLOCKED event
committed while the surface was down never yields a CEO brief (`sweep/s2-startup-drops-pending-events.mjs`);
m-47 model-authored delegation instructions reach the delegate's context as L2 without layer-marker
neutralization (prompt-level only; authority enforced by the runtime); m-48 declined / cancelled delegations
keep consuming the parent's delegable allotment.

### 8.5 MINOR (recorded; fixed only when part of the same root-cause change or extremely narrow)

| ID | Residual | Family / note |
|---|---|---|
| m-01 | Restart between a delegate's clarification request and its WAIT settle turns the request back into ACCEPTED (question lost) | R2-04 family; narrow (accept only from OFFERED) |
| m-02 | Delegate and delegator can wait on each other over an unanswered clarification with no attention signal | R2-04 family |
| m-03 | CEO_BRIEF threads bind the CEO *person*; after cover / replacement the acting CEO's briefs are refused; a second brief for a completed context throws DEDUPE_CONFLICT | C4 / C5 |
| m-04 | Retiring an Employee leaves its PRIMARY seat held (health under-reports vacancy; reports snapshot a retired Director) | C2 / C4 |
| m-05 | Cap raise wakes only the first 1000 leaves (folded into R2-03's fix) | R2-03 family |
| m-06 | A charged failure whose settlement hits local contention (SETTLEMENT_FAILED) loses its P-07 deployment exclusion (one extra call; money held) | R1-09 / P-07 |
| m-07 | Delegated lineage spend is bounded per level, not by the root Work Item cap (≈4× at depth 3) | PG-06 |
| m-08 | An APPROVED approval cannot be revoked and Command-Center approvals never expire | PG-07 |
| m-09 | Org grants are always evaluated at resource `*` (department-scoped org grants never cover) | amplifies R2-01; PG-08 |
| m-10 | Command Center APPROVAL_DECIDE preview summary names the Work Item, not the action / arguments | PG-02 |
| m-11 | A judge Work Item that ends FAILED / CANCELLED leaves its judgment ASSIGNED until the next start; a dead-lettered (BLOCKED) review / judge Work Item never releases its key (code comment claims it does) | Release-on-every-end-path; narrow |
| m-12 | A withdrawn reviewer / judge is excluded from that subject forever (folded into R2-07's fix) | R2-07 family |
| m-13 | Open judgments are not counted in reviewer capacity (8 open > cap 5) (folded into R2-08's predicate) | R2-08 family |
| m-14 | `ReviewStore.sweep` doc claims a supervisor caller; only startup recovery sweeps | Doc |
| m-15 | Qualification SUSPENDED / REVOKED withdraws review assignments but not judgments (refused later at decision) | R2-08 family |
| m-16 | Refill takes the oldest 200 pending judgment subjects; never-drawable subjects crowd the window (PLAUSIBLE) | R1-12 crowding family |
| m-17 | Driver failure codes are not secret-checked before audit (`AKIA…` in `reason_code`) | folded into R2-10 |
| m-18 | A provably not-executed tool attempt still consumes the grant use / single-use approval / review | C2 |
| m-19 | Non-plain tool results recorded differently on the invocation and the step result | folded into R2-10 |
| m-20 | Model-authored FounderBrief fields and `goal.derive` title / summary / criteria are not secret-scanned (siblings are) | Secret-guard consistency; narrow |
| m-21 | `txGoalAct` lacks the role-certification and Academy-run checks `txOrgAct` applies | C5 parity; narrow |
| m-22 | A failed LIVE upgrade verification with another connection open (Windows EPERM) leaves no UPDATE_HOLD | R2-30 family; hold-first ordering |
| m-23 | Retention and status trust `backup_records`, not files: retention can keep a lost generation and retire restorable ones; after a clean restore, earlier generations' records show as the local recovery point | Record-only accounting |
| m-24 | A malformed portable header raises a raw TypeError, not BACKUP_INTEGRITY (still fails closed) | R1 C-F5 recurrence |
| m-25 | An older generation restores silently (no package age in the report); restore migrates an old snapshot forward through plain open | R2-29 / R2-30 family |
| m-26 | R-C6-03 re-worded: in-memory packaging peaks at ≈6× payload (≈9 GB at the 1.5 GiB bound); fits the 31 GB host; streaming is future work | Residual |
| m-27 | Report periods closed at both ends (boundary events in two dailies); historical `at` reads current state; registered `minimumEvidence` is dead configuration; `evaluations()` returns the oldest 5000 | Reporting hygiene |
| m-28 | Weekly REPEATED_FAILURE_PATTERN claims are emitted for unvalidated CANDIDATE findings labelled SUFFICIENT_EVIDENCE | Reporting |
| m-29 | `generateReport` computes whole history inside one write transaction; `detectAndRecordSystemic` scans all validated attributions; evidence gathering scans tables without `work_item_id` indexes (≈0.5–2 s lock at one year of use, under the busy timeout) | Performance note |
| m-30 | Reciprocal collusion (A judges B, B judges A) is not prevented | PG-05-adjacent |
| m-31 | Zero recorded cost scores EFFICIENCY POSITIVE (tool-only work) | R2-20 family |
| m-32 | Reviewer meta-evaluation is circular under REVIEW_POOL plans; judges are never meta-evaluated | PG |
| m-33 | Founder Attention: "no verified backup / no off-device package ever" are non-material; a failed drill does not signal the live surface until a read | C6 / C5 |
| m-34 | An open browser tab after a restart is never refreshed or locked | C5 UI |
| m-35 | CEO brief can brief its own blocked brief Work Items (bounded by budget / backoff; PLAUSIBLE) | C5 |
| m-36 | Unauthenticated requests write one audit row each; SSE streams per session uncapped and survive logout / revocation (content-free) | Loopback-only |
| m-37 | Verifier sqlite / network confinement is lexical: `process.getBuiltinModule` and template-literal `import()` bypass it; rule-scope narrowing is not caught by self-tests | Proof |
| m-38 | Mutation oracle counts a module-load SyntaxError as "caught"; `replace` text is not pinned | Proof (N-PROOF) |
| m-39 | Test runner accepts a file truncated by `process.exit(0)` and try/catch-swallowed assertions | Proof (R1-15 limit) |
| m-40 | docs-only classifier accepts Windows-hostile paths (`aux.md`, `a:b.md`, case collisions) and docs-fast runs Ubuntu only | Proof / Windows parity |
| m-41 | Generic `STORAGE_INVARIANT` assertions across ~30 trigger proofs (plausible vacuity beyond R2-32) | Proof |
| m-42 | SIGINT graceful stop proven only on non-Windows; network-filesystem refusal Linux-only | OS parity |
| m-43 | Founder rail "Decide" can only approve; the preview modal auto-focuses Confirm; BUDGET_CEILING summary always says "Raise" | C5 UI |

### 8.6 PRODUCT GAPS and AUTHORITY CONFLICTS (not code defects; not invented)

| ID | Question | Current behaviour (kept) |
|---|---|---|
| **AC-01** | `AUTHORITY CONFLICT — PRODUCT OWNER REVIEW REQUIRED`: a Director's seat alone derives and activates a Department goal with no explicit grant (`r2-ah/p2-goal-title-authority.mjs`). D-C5-04 recorded "seat-checked"; the Founding Constitution ("Director title does not itself grant authority"), Stage 3 ("effective authority comes from explicit grants") and Stage 2 ("within authority and budget") point to an explicit grant | Seat-checked, per D-C5-04; no change without a Product Owner ruling |
| PG-01 | May a non-Founder (a delegator Director) supersede a delegated Work Item's plan in a *weakening* way (drop a FOUNDER key, flip judgment to REVIEW_POOL, relax independence)? | Delegator supersession stays as designed; R2-01 removes only the executor's own path |
| PG-02 | What must the Founder see when approving an R3 action (its arguments)? The durable action subject (R2-11) makes it implementable | Objective + risk only |
| PG-03 | Does an author's own reuse count as a "verified reuse" of a successful pattern? | After R2-16: allowed, but only with distinct evidence per reuse |
| PG-04 | Founder forms for decisions that need values: charging a held reservation (provider-reported tokens), verifying an outcome (evidence classes / refs) | API / structured preview only; no UI form |
| PG-05 | Claim-free C6 lessons are never invalidated by canonical-truth change; attribution judge may be the reviewer whose verdict produced it (D-C6-10 exclusions implemented literally) | Unchanged |
| PG-06 | Is delegated lineage spend bounded by the root Work Item cap? | Per-level bound |
| PG-07 | Approval revocation / default expiry for Command-Center approvals | Not revocable; no expiry |
| PG-08 | Department-scoped organizational grants | Resource `*` only |
| PG-09 | What is "proven stable" (the end of the rollback window) after an update? | R2-31 adds acknowledgement, not a time bound |
| PG-10 | A bulk reconciliation workflow after a device-loss restore | Per-job reconciliation (R2-21 / R2-29) |
| PG-11 | Families for `PROVIDER_INVALID_REQUEST` / `PROVIDER_CONTENT_POLICY` in causal attribution | Left unclassified (explicitly) by R2-12 |

## 9. Existing residuals re-checked (hypotheses, not automatic defects)

| Residual | Result |
|---|---|
| R1 N-DET1 (denylist) | Unchanged; demonstrated bypass only through R2-10 (fixed there) |
| R1 N-HEALTH / N-SEAM | Hold (content-free outputs; seam gated by condition + load check) |
| R1 N-RETRY | Tool `'TIMEOUT'` / `'CANCELLED'` string markers still present — refuted as a defect (same outcome) |
| R1 N-TOOL | Unchanged MINOR |
| R1 N-COST / N-ACAD | Unchanged MINOR |
| R1 N-DB | Still true (record before full verify; verify→restore copy not re-hashed; append-only by trigger); trigger proofs partly vacuous → R2-32 |
| R1 N-PROOF | Still true and wider (m-38) |
| R1 N-WORK | Risk changed: the same Completed ≠ Reviewed family is reachable through C4 delegation with a required review → R2-05 |
| R1-06 lost wake | Closed for the named events; recurs for events outside the named set → R2-02 / R2-03 / R2-04 |
| R1-09 boundary | Provider side intact; never applied to tools → R2-10 |
| R1-12 re-check / crowding | Recurs at the Review Pool decision re-check → R2-07 / R2-08; m-16 |
| R1-14 frozen migrations | Regressed for 0007–0010 → R2-33 |
| R1 C-F5 | Fixed for the manifest; recurs in the portable header → m-24 |
| P-01 (ON_LEAVE role change) | Still fails closed; MINOR |
| C5 CSP Department tint | Still present (`style-src 'self'`); cosmetic MINOR |
| C5 4 fps capture | Proof-only; the CI smoke uses `--spike` and does not capture frames |
| R-C6-02 report view | Confirmed MINOR; the larger gap is R2-21 |
| R-C6-03 in-memory package | Re-worded (m-26) |
| R-C6-05 thresholds | Worse than stated: the registered `minimumEvidence` is dead config (m-27); thresholds are compile-time constants |
| R-C6-06 | Systemic diagnosis Founder-only — and unreachable in production (R2-21); no deterministic verifier before C7 (acceptable); judge capacity understated (m-13) |

## 10. Performance / scale notes (§17)

No correctness-threatening unbounded loop found. Notes: report generation and systemic detection scan
history inside write transactions (m-29); Review Pool refill runs correlated per-candidate counts and an
unindexed `substr` join (bounded by LIMITs); attention sync runs ~20 queries per read inside
`BEGIN IMMEDIATE` and every GET refreshes the session (`last_seen_at`) as a write; portable packaging ≈6×
payload in memory (m-26); the only spin found is R2-04 (bounded by `maxTurns`, but paid). The browser refresh
is coalesced (≤1 in flight + 1 queued) — no storm.

## 11. Proposed remediation plan (after this freeze)

One remediation wave, by root-cause family, reusing canonical mechanisms; one new numbered migration
(`0011`) for the trigger / CHECK / table changes that 0001–0010 cannot take (R2-01 defence trigger, R2-05,
R2-11, R2-16, R2-21), frozen by content with 0007–0010 (R2-33). Regression proofs go into the owning
stage's existing suites; mutations into the owning stage's mutation script (c2, c3, c4, c5, c6, r1) — no
large new R2 acceptance or mutation suite. MINORs are fixed only where they are part of the same root-cause
change (m-05, m-11, m-12, m-13, m-15, m-17, m-19, m-22) or extremely narrow (m-01, m-20, m-21, m-24, m-25,
m-45); the rest stay residual.

**Frozen totals:** 1 BLOCKER (R2-01), 32 MAJOR implementation defects (R2-02 … R2-31, R2-34, R2-35),
2 MAJOR proof defects (R2-32, R2-33), 48 MINOR, 1 authority conflict (AC-01), 11 Product gaps. No
infrastructure / environment defect beyond the known host quirks (Bash tool, `security-review` launch).
