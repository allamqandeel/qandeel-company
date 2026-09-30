# R2 — Full Strong-v1 Independent Review Report

**Status:** **STOPPED — NOT CLOSED.** The final fresh re-review (§15) reproduced a third recurrence in three
root-cause families (budget-wait resume, C6 evidence time, restore lifecycle); by rule no third patch was made and
the families are returned to the Technical Lead / Founder as architecture problems. **Not ready for C7.**
§1–§11 are the register frozen at `dc408a3` before any code change; §12–§15 record the remediation waves and
re-reviews; the identity and root cause of every frozen finding stay traceable.

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

---

*Everything above this line is the register frozen at `dc408a3`. The sections below were added after it.*

## 12. Remediation wave (after the freeze)

One wave, by root-cause family. The base commit `8a8d494` carries migration `0011_r2_integrity.sql` (the datastore
half of R2-01, R2-05, R2-11, R2-16, R2-21) and the two proof fixes. Seven clusters then worked in isolated git
worktrees from that base and were merged one by one into `review/r2-full-strong-v1`; the integration seam that only
the merged tree could show was closed in `ced8f30`. Every regression proof below was run against the unfixed code
first and failed; it passes on the fix. Material decisions: DECISION_LOG D-R2-01 … D-R2-08. No new Product
behaviour: every fix restores an existing contract (authority, recorded decision or stage invariant); where a fix
needed a choice the authority leaves open, the conservative default is named and the question stays a Product gap.

| Commit | Cluster | Findings |
|---|---|---|
| `8a8d494` | base | 0011 migration; R2-32, R2-33 |
| `5c44322` → merge `224d605` | K6 resilience | R2-28, R2-29, R2-30, R2-31 (+ m-22, m-23, m-24, m-25) |
| `a36b880` → merge `01f5d6f` | K5 Founder | R2-21 … R2-26 (+ m-20, m-21, m-43) |
| `794facf` → merge `196edff` | K1 review | R2-01, R2-02, R2-07, R2-08, R2-09, R2-11 (+ m-11 … m-15) |
| `c53a29e` → merge `63d2ab8` | K7 C3 | R2-27, R2-34, R2-35 |
| `ced8f30` | integration | R2-29 × R2-21 / R2-22 seam |
| `ce5d95b` → merge `e00c03e` | K4 C6 | R2-13 … R2-20 (+ m-31) |
| `07c3c0b` → merge `2a46773` | K3 boundary | R2-10, R2-12 (+ m-17, m-19) |
| `cbd26ca` → merge `4301dfc`, `9a8f537` | K2 waits | R2-03 … R2-06 (+ m-01, m-05) |

### 12.1 Per finding

| ID | Root cause (corrected at) | Fix | Regression proof (fails before, passes after) | Mutation(s) |
|---|---|---|---|---|
| R2-01 | Plan authority not separated from execution; rejection scoped by plan | Owner may declare v1 before its first run only (`SELF_REVIEW_REDESIGN`, 0011 trigger); REWORK by (Work Item, action fingerprint) | `c4-review` "R2-01: the executor never re-designs its own Review Plan …" (app refusal, the trigger's own message on a forged insert, rejection survives a Founder v2) | `c4r2-executor-redesigns-own-plan`, `c4r2-rework-scoped-by-plan` |
| R2-02 | STALE without a targeted wake | `wakeStrandedActionWait` at plan declaration, plan-superseded decision, WAIT re-check, startup sweep | `c4-review` "R2-02: a plan change wakes the executor …" (4 cases) | `c4r2-stranded-action-wait-not-woken` |
| R2-03 | Budget-wait resume predicate knew only cap raises; raise limited before filter | `wakeBudgetWaiters` (waiter-driven, headroom-gated) on settle / release / reconcile / raise / WAIT re-check / startup | `r1-review` "R2-03: …" (incl. m-05, 1 001 items); runtime "R2-03: work parked on a sibling's transient worst-case reservation resumes …" | `r2-03-freed-headroom-wakes-nothing`, `r2-03-budget-wake-ignores-headroom`, `r2-03-budget-recheck-ignores-freed-headroom` |
| R2-04 | Two definitions of "open handoff" | One `OPEN_HANDOFF_STATES`; a delegator answers its own delegate's question; accept only OFFERED | `c4-organization` "R2-04: an escalated handoff parks its delegator …", "R2-04 / m-01 …"; `c4-runtime` escalation park + processor unit | `c4-open-handoff-set-narrowed`, `c4-delegator-waits-on-own-clarification`, `c4-restart-answers-clarification` |
| R2-05 | Delegation trigger conflated Completed with Reviewed | 0011 trigger: review-required children close at REVIEWED or later | `c4-organization` "R2-05: a review-required child closes its handoff only once REVIEWED …" (fails on the 0010 trigger: probe `r2-ah/p8`) | — (datastore guard; proof asserts the trigger) |
| R2-06 | Child floor counted dead children | `CHILD_CAN_SPEND_SQL` for the floor and `accountingInvariants` | `c2-governance` "R2-06: …"; `c4-organization` transfer below a CLOSED envelope | `budget-floor-counts-finished-children`, `budget-floor-ignores-running-run` |
| R2-07 | Selection ≠ decision re-check; "prior" included WITHDRAWN; greedy key order | One predicate; MANAGER / SHADOW exemption at decision; MANAGER / FOUNDER first; transient withdrawal not permanent | `c4-review` "R2-07: the MANAGER key is satisfiable …" (3 cases) | `c4r2-manager-key-department-bound`, `c4r2-manager-key-filled-last`, `c4r2-withdrawn-reviewer-excluded-forever`, `c6r2-withdrawn-judge-excluded-forever` |
| R2-08 | Decision re-checks ignored RUBRIC holds / envelope; capacity ignored judgments | Same predicate + RUBRIC hold + OPEN envelope; capacity counts judgments; suspension withdraws judgments | `c4-review` "R2-08: a RUBRIC Quality Hold stops reliance …"; `c6-founder-free` "R2-08 / m-15 …" | `c4r2-rubric-hold-not-rechecked`, `c6r2-judge-rubric-hold-not-rechecked`, `c6r2-judgment-survives-qualification` |
| R2-09 | Lesson gate on one path, bypass on three | Every lesson draw through the gate (`assignJudge` refuses otherwise) | `c6-founder-free` "R2-09: no lesson judge is drawn … before … evidence" | `c6r2-lesson-judge-drawn-before-evidence` |
| R2-10 | R1-09 boundary never applied to tools | `tool-boundary.ts` snapshot; `txToolResult` reads once and guards the serialized value | `r1-runtime` "R2-10 tool-driver boundary …" (6); `r1-review` "R2-10 defence in depth …" | 6 × `r2-10-*` |
| R2-11 | Subject not durable / single-sourced | `review_action_subjects` written once; full arguments; `REVIEW_SUBJECT_TOO_LARGE`; `SECRET_MATERIAL` before any request | `c4-review` "R2-11: the action reviewer sees the whole action on every fill …" | `c4r2-action-subject-truncated`, `c4r2-oversized-subject-admitted`, `c4r2-secret-arguments-reach-reviewer` |
| R2-12 | No shared run-failure vocabulary | `run-failures.ts` table; real causes emitted; local failure `SETTLEMENT_FAILED`; exhaustiveness proof | `r1-runtime` "R2-12: one run-failure vocabulary …" + busy-settlement code; `c6-runtime` "R2-12: … missing route policy is a WORKFLOW cause" | `r2-12-local-settlement-blamed-on-provider`, `r2-12-vocabulary-incomplete`, `r2-12-pg11-family-invented`, `c6-config-cause-blamed-on-provider` |
| R2-13 | All-runs failure counting; any system signal suppressed the Employee cause | Unrecovered vs recovered failures; recovered at most CONTRIBUTING; new KNOWN_BAD calibration case | `c6-improvement` "R2-13 …"; kernel proof | `c6-recovered-failure-is-the-cause` |
| R2-14 | Evaluation row treated as the unit | One latest live evaluation per Work Item; supersede across versions | `c6-improvement` "R2-14 …" (3 live → 1) | `c6-work-item-counted-per-definition` |
| R2-15 | Evaluation time used as work time | `workStartedAt`; baseline / evidence by Work Item | `c6-improvement` "R2-15 …" | `c6-pre-training-work-counts-as-later` |
| R2-16 | Same evidence credited twice | Disjoint-evidence gate (0011 + app), one open reuse, self-reuse not contribution | `c6-improvement` "R2-16 …" (×2) | `c6-pattern-reuse-evidence-reused`, `c6-self-reuse-credited` |
| R2-17 | Unvalidated adverse evidence treated as absent | Adverse follow-up without a VALIDATED cause holds NOT_YET_TESTED | `c6-improvement` "R2-17 …" | `c6-pending-recurrence-ignored` |
| R2-18 | Same family; REJECTED dead end | NOT_READY + disclosure; judge FAIL on an attribution escalates to the Founder (D-R2-06) | kernel "R2-18: adverse evidence …"; `c6-founder-free` "R2-18: a pool judge who disputes …" | `c6-pending-adverse-reads-clean`, `c6-disputed-cause-dead-end` |
| R2-19 | Permanent dedup across terminal states | Linked generations `key#n`; exhaustion merges | `c6-improvement` "R2-19 …" (×2) | `c6-decided-finding-silences-recurrence`, `c6-retraining-exhaustion-swallowed` |
| R2-20 | Billed cost used as cost | Economic micros; billed separate; zero cost NOT_ASSESSED | `c6-improvement` "R2-20 …"; kernel "m-31 …" | `c6-billed-cost-as-economic`, `c6-zero-cost-efficient` |
| R2-21 | Founder decisions never wired to the surface | Nine structured-only governed intents; rail actions | `c5-founder-surface` "R2-21 / R2-22: … decided through governed previews in the session (no test seam)" | `c5-exception-decision-overtakes-tool` |
| R2-22 | Attention sources incomplete | Per-entity DECISION_REQUEST sources at stable change times; governed-job predicate (`ced8f30`) | same; `c6-resilience` R2-29 test extended (restore holds reach attention; operator path refused) | `c5-attention-misses-uncertain-effects`, `c6-restore-hold-left-to-operator` |
| R2-23 | Verb tested after it was stripped | Classifier returns the target state | kernel "R2-23 …"; surface "R2-23 / R2-24 …" | `c5-goal-state-verb-lost` |
| R2-24 | Structured acts re-serialized; fallback / default decision | Structured rail previews; no fallback; no default | kernel "R2-24 …"; surface test | `c5-unmatched-argument-falls-back` |
| R2-25 | Class-level keys; dismissal until "resolves" | Instance keys; reopen on source change | `c5-founder-surface` "R2-25 …" | `c5-dismissal-swallows-source-changes`, `c5-resilience-keyed-per-class` |
| R2-26 | Effect and CONFIRMED in separate transactions | One `BEGIN IMMEDIATE`; boundaries join as savepoints | `c5-founder-surface` "R2-26: a confirm is one transaction …" | `c5-confirm-effect-commits-alone` |
| R2-27 | Promotion bypassed the Write Policy | Shared `txOpenMemoryConflicts` | `c3-mind` "R2-27 …" | `r2-personal-promotion-skips-conflict` |
| R2-28 | Volume id taken as device proof | Only ATTESTED is off-device | `c6-resilience` "… second partition … (R2-28)" | `c6-separate-volume-counts-as-off-device` |
| R2-29 | Restore not an ambiguity boundary | Effect-capable live jobs held `RESTORED_PAST_BACKUP_POINT`; disclosure | `c6-resilience` "… ambiguity boundary … (R2-29, m-25)" | `c6-restore-dispatches-past-backup-point` |
| R2-30 | Lifecycle optional at open | Existing Company refused at open (`SCHEMA_UPDATE_REQUIRED`); start runs safe-upgrade; hold first; `DATABASE_IN_USE` | `migrations` "R2-30 …"; `c6-resilience` "… (R2-30, m-25)", "(m-22)"; runtime "start runs safe-upgrade automatically …" | `c6-existing-company-migrated-at-open`, `c6-start-skips-safe-upgrade`, `c6-maintenance-ignores-open-connection` |
| R2-31 | Rollback a file swap | Refused on post-activation work unless acknowledged; retained pre-rollback snapshot; report | `c6-resilience` "(R2-31)" | `c6-rollback-discards-post-update-work` |
| R2-32 | Nested-transaction refusal satisfied the proof | Judge Work Item created before the forged insert; the trigger's own message asserted | `c6-founder-free` "nobody forges …" (now fails if the trigger is neutered) | — (proof fix) |
| R2-33 | Frozen list not extended at C4–C6 | 0007–0010 frozen by content | verifier self-test (69/69) | — (verifier) |
| R2-34 | SIMULATION exit ignored retest provenance | Retest-aware gates; same-kind remediation link | `c3-mind` "R2-34 …" (×2) | `r2-simulation-gate-counts-retrained-failure`, `r2-retry-strands-started-retest`, `r2-practice-consumes-assessment-retest` |
| R2-35 | Plan-time snapshot used as authority set | Live set recomputed at rollout; rollback returns every moved passport | `c3-mind` "R2-35 …" | `r2-rollout-uses-plan-snapshot`, `r2-rollback-misses-rolled-out-passports` |

Existing proofs changed (never weakened): `migrations` v1/v6/v2 upgrades use the explicit live-update test knob;
`surface.test` input "approve the campaign" → "approve حملة أداء" (the old text only worked through the forbidden
fallback); `c6-acceptance` step `a-real-tool-failure-is-not-blamed-on-the-employee` encoded R2-13 and now asserts
the recovered failure is recorded but never primary; `c6-acceptance` attention key retargeted to the per-instance
key; `governed-runtime` waits now name the real code (`FALLBACK_REFUSED`, `PROVIDER_FAILURE`). Mutation anchors
retargeted with the same meaning: `c4-decision-not-rechecked`, `c6r1-self-judgment`,
`c6r1-judge-eligibility-not-rechecked`, `c5-preview-fingerprint-unchecked`, `r1-01-tool-result-secret-stored`,
`c6-tool-failure-unmapped`, c1 `recovery-without-supervisor-verification` (count 9 → 10: the R2 startup
budget-wait pass is supervisor-fenced too).

### 12.2 MINORs fixed with their root cause (not separately)

m-01, m-05, m-11 … m-15, m-17, m-19, m-20, m-21, m-22, m-23, m-24, m-25 (and m-8 disclosure), m-31, m-43.
Everything else in §8.5 stays residual.

### 12.3 New residuals recorded during remediation (MINOR)

| ID | Residual |
|---|---|
| m-49 | Delegations closed COMPLETED early by the 0010 trigger in a database that predates 0011 are not rewritten (the Pilot has not started; a repair would be a Product decision) |
| m-50 | The Employee sheet's "Set budget ceiling" button still sends text and previews nothing (needs a value; PG-04 family) |
| m-51 | The existing C6 mutation `c6-restore-releases-uncertain-effect` is caught only because its injected SQL names a column `queue_jobs` lacks (m-38 family) |
| m-52 | A budget waiter with positive-but-insufficient headroom is woken by each freeing event on a shared level (every chain shares the Company level) and re-parks before any spend — churn, never spend |
| m-53 | Node 24.19 on Windows: `rmSync` of a file another process holds open, under a non-ASCII path, kills the process (0xC0000409) instead of throwing — maintenance now uses `unlinkSync`; other `rmSync` call sites operate on paths the runtime alone holds (INFRASTRUCTURE / ENVIRONMENT note) |
| m-54 | A start within the previous supervisor lease's TTL (≤ 30 s after a crash) with a pending migration refuses (`RUNTIME_RUNNING`) instead of waiting — fail-closed |
| m-55 | A Founder-REJECTED attribution leaves its negative pending (disclosed, holds readiness) — the Founder's call; correcting causes is API-only (PG-04) |
| m-56 | `REASONING_ABOVE_CEILING`, `INTEGRITY_FAILURE` and storage recovery / interrupt codes are outside the classified run-failure families (PG-11) |
| m-57 | ~~The PERSONAL promotion path performs no canonical-truth check at promotion time~~ — refuted by the re-review: canonical truth is re-checked on insert |

## 13. Fresh independent re-review (head `9a8f537`)

Four reviewers who wrote none of the fixes read the corrected code in isolated worktrees, re-ran every original
finder probe against it, ran scenarios the fixers did not author, and hunted for regressions (RR1 authority /
review / Founder; RR2 Work OS / money / tool; RR3 C6 / C3; RR4 resilience / proof / cross-cluster seams). RR4
also rebuilt real pre-R2 (schema 10) Companies from the previous release's acceptance runs and packages.

### 13.1 Original findings re-verified

FIXED at the root, with the original probe now refused / correct: R2-01 (plus delegate-declares-on-parent and
self-delegation refused), R2-02, R2-05, R2-06, R2-07, R2-08, R2-09, R2-10, R2-11, R2-12 (named cases), R2-13, R2-14,
R2-15 (as specified), R2-16, R2-17, R2-19, R2-20, R2-21 (API), R2-22, R2-23 (reported cases), R2-24 (rail), R2-25,
R2-26 (join and session scope reset in `finally`; savepoints sound), R2-27, R2-28, R2-29 (portable restore), R2-30,
R2-31, R2-32 (neutering the trigger now fails the proof), R2-33, R2-34, R2-35; m-01, m-05, m-11, m-12, m-15, m-17,
m-19. The Founder's real pre-R2 workspace upgrades 10 → 11 automatically at start (Command Center path included,
Arabic path included, `founder_action_previews` rows kept). AC-01 untouched. Six new mutations were applied by
hand and each failed on its intended assertion (no load-error catches). All seven mutation suites pass on the
merged tree (c1 6, c2 21, c3 46, r1 57, c4 39, c5 25, c6 65); `npm test` 683 / 683.

Partly fixed: R2-03 (lost wakes closed, but see RR2-1), R2-04 (escalation closed, but see RR2-2), R2-18 (pool
dispute escalates, but see RR3-A).

### 13.2 New findings of the re-review

| ID | Severity | Family (cycle) | Finding | Reproduction |
|---|---|---|---|---|
| RR2-1 | MAJOR | R2-03 (2nd) | The headroom-gated budget wake gates on "any headroom", not on what the waiter was refused for; every chain shares the Company level, so every settle wakes every parked waiter, which re-parks — durable runs / events / audit grow ≈ settles × waiters and real work is starved (no spend) | `rr2/r2c/rr1-wake-storm.mjs` (N=20: +200 runs, 1 300 events per 10 settles; N=150: sibling 7× slower) |
| RR2-2 | MAJOR | R2-04 (2nd) | A FINAL refused for a pending clarification tells the model nothing; a delegator can spend every turn to MAX_TURNS and FAIL, leaving the handoff and the child open under a FAILED parent | `rr2/r2-ah/rr3-clarify-spin.mjs` |
| RR2-5 | MINOR | R2-05 seam | A CANCELLED parent leaves an ACCEPTED delegation whose retained child later reworks | `rr2/r2-ah/rr5-cancel-parent-open-handoff.mjs` |
| RR2-3 | MINOR | R2-12 | `NO_ELIGIBLE_ROUTE` classified PROVIDER though mostly configuration / privacy / input gates | `rr2/r2-e/rr4-no-route-family.mjs` |
| RR2-4 | MINOR | R2-06 | A COMPLETED (no required review) child can be re-released through optional review after its parent was lowered below its cap (money still bounded by the chain check) | `rr2/r2c/rr2-floor-revive.mjs` |
| RR2-6 | PROOF / MINOR | R2-12 / R2-05 | C1-layer run codes missing from the vocabulary table; no repair of rows closed early by 0010 (m-49) | source |
| RR3-A | MAJOR | R2-17 / R2-18 (2nd) | A Founder REJECT of a proposed cause is a dead end: the production intent cannot correct causes, nothing re-proposes, the intervention stays NOT_YET_TESTED forever and retraining waits forever | `rr3/pa-founder-reject-dead-end.mjs` |
| RR3-B | MAJOR | R2-18 (introduced) | Non-adverse negatives (EFFICIENCY / INDEPENDENCE) on qualified items are counted "pending attribution" though no attribution can exist — readiness held 90 days | `rr3/pb-nonadverse-negative-holds-readiness.mjs` |
| RR3-E | MAJOR (borderline) | R2-15 (2nd) | A comparable item started before training, reworked after it and failed is neither baseline nor follow-up — a final IMPROVEMENT_OBSERVED follows | `rr3/pd-cross-code-and-rework-timing.mjs` |
| RR3-D | MINOR | R2-14 | Latest live evaluation across codes can hide a qualified outcome under a stricter code; tie-break differs between two readers (no production caller passes another code) | same |
| RR3-F | MINOR | docs | `txApplyJudgment` docstring still says FAIL rejects attributions (D-R2-06 records the amendment) | source |
| RR3-G | MINOR | R2-27 | PERSONAL promotion skips the policy's DUPLICATE refusal (a second equal memory) | source |
| RR1-1 | MAJOR | R2-23 / R2-24 (2nd) | A verb inside a goal's title overrides the command's own verb: "cancel the accept vendor returns goal" previews and confirms approve-and-activate | `rr1/n2-goal-verb-crossover.mjs` |
| RR1-2 | MAJOR | R2-02 / R2-08 (2nd; introduced by the m-13 fold) | Open judgments now count toward reviewer capacity, but freed capacity wakes nothing and the startup sweep has no clause for a waiting ACTION request — C6 judgments starve a blocking review; the executor stays stranded across restarts | `rr1/r2-ah/n3-judgments-starve-reviews.mjs` |
| RR1-3 | MINOR | R2-07 | The MANAGER exemption at decision does not re-check that the holder is still the executor's manager | source |
| RR1-6 | MINOR | R2-21 | PROMOTION_DECIDE and SYSTEMIC ADDRESSED have no attention source / UI entry (API only) | source |
| RR1-7 | MINOR / PG | R2-11 | Plan instructions + a large action can exceed the 12 000-character reviewer bound (refused until re-planned); a restore-held never-run job's primary rail button reads "Confirm completed" | source |
| RR4-1 | MAJOR | R2-29 / R2-30 (2nd) | `restore-check` leaves a startable, live-migrated Company with no restore holds at an operator path — two Companies can perform the same external effect | `rr4/p4-restore-check-startable.mjs` |
| RR4-2 | MINOR | m-53 | `rmSync` remains at other maintenance / resilience sites; a prune racing a reader under an Arabic path kills the process | `rr4/p3-rmsync-locked.mjs`, `rr4/p6-prune-locked.mjs` |
| RR4-3 | MINOR | R2-31 | The automatic upgrade at start writes lifecycle audit rows, so every rollback needs the discard acknowledgement | `rr4/p5-rollback-after-autostart.mjs` |
| RR4-4 | MINOR | R2-30 | A start within ~30 s of a crash on a new release is refused (`RUNTIME_RUNNING`) instead of waiting (m-54) | source |
| RR4-5 | PROOF / MINOR | R2-33 | 0011 is not yet frozen (it joins at release); a frozen-file edit reports "SELF-TEST FAILED" (still exit 2, file named) | experiment |
| RR1-4 / RR1-5 | — | — | c1 anchor count and missing decision records — already closed in `989e9fe` (the re-review ran on `9a8f537`) | — |

PG note (extends PG-01): a delegator writes the child's version-1 plan, not bound by the parent's plan — a FOUNDER
key on the parent can be dropped by delegating the same action (bounded by delegation limits; Stage 11 silent).

**Disposition.** Eight MAJORs, all in families already corrected once (none is a new family). Under the brief's
rule this is the **second and last** correction cycle for each of them: one architecture-level correction per
family (§14), then a focused re-verification. A third recurrence of any of these families stops R2 and returns it
to the Technical Lead / Founder as an architecture problem. MINORs are fixed only where narrow and in the same root
change (RR2-3, RR2-5, RR2-6 vocabulary, RR1-3, RR3-F, RR4-2, RR4-3); the rest are residuals.

*Amended by Product Owner direction during the second wave: MINORs are fixed only when directly part of the same
root cause as a MAJOR of the wave — so RR2-5 (same seam as RR2-2) and RR3-F (the RR3-A semantics) were fixed, and
RR2-3, RR2-6, RR1-3, RR4-2 and RR4-3 stay residuals (§15).*

## 14. Second (and last) correction wave

Scope locked by the Product Owner after RR1: no new finders; every BLOCKER / MAJOR of the re-review in one coherent
wave; MINORs only when part of the same root cause. Four clusters in isolated worktrees from `989e9fe`, each fixing
the **mechanism** of its family (not the one symptom), each proof failing before its fix; merged into
`review/r2-full-strong-v1` as `a56bc06`. Decisions: DECISION_LOG D-R2-09 … D-R2-14.

| Family (cycle 2) | Re-review finding | Mechanism corrected | Proof (fails before → passes) | Mutations |
|---|---|---|---|---|
| Budget-wait resume (R2-03) | RR2-1 wake storm | The refusal records its need (`budget_wait_needs`, 0011); one resume predicate — the need fits a fresh Run budget and every level above — on every resume path; no historical scans (D-R2-09) | `r1-review` "RR2-1: a waiter wakes only when the need its refusal recorded fits again …" (`['QUEUED',1]` → `['WAITING',0]`); probe N=20 × 10 settles: +200 runs / +1 300 events → +0 / +100 (siblings only), 3.5 s → 0.75 s | `rr2-1-budget-wake-ignores-recorded-need`, `rr2-1-budget-need-not-recorded`, `rr2-1-budget-wake-ignores-fresh-run-cap` |
| Handoff lifetime (R2-04 / R2-05) | RR2-2 unanswered clarification; RR2-5 cancelled parent | Refused FINAL is a step result the model sees; `work_delegations_follow_parent` (0011) closes a delegator's open handoffs when it ends; a FAILED delegator cancels delegated children canonically; no enqueue under an ended parent (D-R2-10) | `c4-organization` "RR2-2 / RR2-5: a handoff never outlives its delegator …"; `c4-runtime` end-to-end (parent FAILED → handoff CANCELLED / `PARENT_ENDED`, child CANCELLED) | `rr2-2-final-refusal-silent`, `rr2-2-failed-delegator-keeps-children`, `rr2-5-rework-under-ended-lineage` |
| Review wake / eligibility (R2-02 / R2-08) | RR1-2 judgments starve reviews | Freed capacity is a wake in the same transaction; REQUIRED before oversight before judgments; judge draws yield; sweep refills waiting ACTION requests (D-R2-11) | `c6-founder-free` "RR1-2" (5 tests; e.g. "the freed slot went to the oldest waiting REQUIRED review at once (no restart)") | 7 × `c6rr1-*` |
| C6 adverse evidence (R2-17 / R2-18) and evidence time (R2-15) | RR3-A Founder REJECT dead end; RR3-B non-adverse "pending"; RR3-E post-training recurrence dropped | One `adverseStanding` definition for every reader; `attributionDue` recorded per evaluation; REJECTED = decided "no accountable cause" (INCONCLUSIVE, disclosed); corrected causes through `ATTRIBUTION_DECIDE`; asymmetric learning evidence (D-R2-12) | kernel "RR3-A: every attribution state has ONE meaning …", "RR3-B …", "RR3-E …"; `c6-improvement` "RR3-A: a Founder REJECT is a decided …", "RR3-B …", "RR3-E: the same mistake made after the training …" | `c6-rejected-cause-pending-forever`, `c6-rejected-cause-reads-clean`, `c6-rejected-attribution-unread`, `c6-corrected-causes-dropped`, `c6-non-adverse-negative-pending`, `c6-post-training-recurrence-excluded` |
| Founder intent resolution (R2-23 / R2-24) | RR1-1 title verb crossover | The command's own leading verb decides the family and decision; the object picks the act; argument words never select (D-R2-13) | `c5-kernel` adversarial titles (EN / AR); `surface` probe texts → GOAL_STATE CANCELLED, goal stays PROPOSED | `c5-argument-verb-selects-intent`, `c5-argument-noun-selects-act` |
| Restore / maintenance lifecycle (R2-29 / R2-30) | RR4-1 startable restore-check | A restore-check target is a permanently held verification copy; only the controlled restore makes a Company live (D-R2-14) | `backup.test` new proof; `cli.test` (`start` → `UPDATE_HOLD`, `clear-update-hold` → `MAINTENANCE_REFUSED`) | `c6q4-restore-check-copy-unmarked`, `c6q4-restore-check-hold-clearable`, `c6q4-restore-check-copy-opens` |

Migration 0011 gained two sections (the need table and the parent-follow trigger) and was re-pinned; it is still
unreleased (it joins `FROZEN_MIGRATIONS` in the closure change). Merged tree `a56bc06`: build, typecheck, lint
clean; verifier 69 / 69; suites bootstrap 5, domain 22, governance 68, mind 102, storage 362, runtime 118,
command-center 10, command-center-ui 10 — all passing.

Recorded while fixing (MINOR, residual): m-58 the `ATTRIBUTION_DECIDE` preview summary reads "Validate the
proposed cause" even when corrected causes are supplied; m-59 a lesson whose work's cause was REJECTED fails the
learning gate (`ATTRIBUTION_NOT_VALIDATED`), so no pool judge is drawn — the Founder rejects that lesson directly;
m-60 a refill can be crowded only if more than 500 unfillable requests wait ahead in one domain.

## 15. Final fresh re-review (head `a56bc06`) — STOP: third recurrence in three root-cause families

One final re-review, scope locked to the families corrected in §14 and their neighbouring seams (two reviewers who
wrote none of the fixes, isolated worktrees at `a56bc06`; in-scope suites and the C5 / C6 acceptances pass there).
Every BLOCKER / MAJOR it reports was **re-run independently by the orchestrator** before this record.

| Family | Verdict | Evidence |
|---|---|---|
| Handoff lifetime (R2-04 / R2-05) | **CLOSED** | Refused FINAL visible to the model; FAILED / CANCELLED delegators end their handoffs; nested delegation, completed parents, held children, non-delegated C1 children and review Work Items all behave (probes `rr3`, `rr5`, `fa3`) |
| Review capacity wake (R2-02 / R2-08) | **CLOSED** | `n3-judgments-starve-reviews` fixed without a restart; independence kept in refills; withdrawn subjects never re-drawn; judgment starvation bounded |
| Founder intent resolution (R2-23 / R2-24) | **CLOSED** | 70+ adversarial EN / AR commands keep the leading verb's act and decision; R4 / R2 approvals never previewable; the only losses are fail-closed (MINOR) |
| **Budget-wait resume (R2-03)** | **NOT CLOSED — 3rd recurrence** | **FA-1** (MAJOR, borderline): `wakeBudgetWaiters` (`governance-core.ts` ~436–450) tests every waiter against the same unchanged headroom and never subtracts the needs it already woke in the pass, so one settle that frees room for ONE need wakes EVERY waiter whose need fits it; one is served, the rest spend a run and re-park — ≈ Q² / 2 wasted runs to drain Q waiters (durable runs / events / audit / Run budgets / manifests; no spend, no starvation). Re-run: `fa2-herd-storage.mjs` → "N=10 waiters served 10; runs 66 (minimum 11); budget.refused 55; events 429"; runtime `fa1-herd.mjs` N=20 → 173 wasted runs, 1 238 events |
| **C6 evidence time (R2-15)** | **NOT CLOSED — 3rd recurrence** | **FB-1** (MAJOR, borderline; introduced by the RR3-E fix): the adverse "reworked after training" filter (`mind/src/improvement.ts` ~172) uses item-level verdicts, which cannot tell WHEN a mistake happened — work whose every mistake was before training and which the Employee then finished correctly after it counts as a post-training recurrence → a FINAL `NO_IMPROVEMENT` (feeds retraining exhaustion and LEARNING_VELOCITY). Re-run: `f1-effect-time.mjs` → "effect of the training: NO_IMPROVEMENT SAME_MISTAKE_RECURRED \| counts the pre-training mistakes as recurrence: true" |
| **Restore lifecycle (R2-29 / R2-30)** | **NOT CLOSED — 3rd recurrence** | **FB-2** (MAJOR, crash-conditional; present since the first-wave R2-29 fix): `restorePortableBackup` copies the database into the target (`resilience.ts` ~484) BEFORE the controlled-restore transaction that places the restore holds, revokes the lost device's sessions and records the restore (~501); no marker is written first. A process death in that window leaves an ordinary, startable Company with un-held effect-capable jobs. Re-run: `f3-portable-crash.mjs crash / inspect` → "update hold: null", "ordinary (runtime) open: OK, schema 11", "claimed job state: CLAIMED \| queued effect-capable job state: QUEUED", "recovery.clean_restore audit rows: 0" (the reviewer's `f3-start.mjs` then started the runtime on it: READY, two `run.started`) |

### 15.1 Stop decision

Under the brief (§1, §23) and the Product Owner's direction, a third recurrence of a root-cause family is a stop
condition: **no third patch was made.** R2 is **NOT CLOSED**, no `docs/R2_CLOSURE_RECORD.md` is written and no PR is
opened. The three families are returned to the Technical Lead / Founder as architecture problems:

1. **Budget-wait resume.** Resuming parked budget waiters is a *scheduling / admission* problem (who gets freed
   headroom, in what order), not a predicate problem: three designs (cap-only wake → any-headroom wake → per-waiter
   need test) each left a different storm or lost wake. The architecture question is an explicit admission model for
   budget waiters (e.g. a durable FIFO / priority queue per binding level that admits waiters while the freed amount
   covers their recorded need, decrementing as it admits), and whether contention on a shared envelope should be a
   WAIT at all (the question R2-D first raised).
2. **C6 evidence time.** Learning-effect evidence needs event-level time (when each mistake / review verdict / outcome
   happened), not item-level verdicts with item-level timestamps: every item-level rule (evaluation time, first-run
   time, last-run time) misclassifies one class of reworked work. The architecture question is attributing each
   adverse / positive signal to the run or review decision that produced it, and the Product decision of how work
   spanning a training boundary counts (RR3-E and FB-1 are the two sides of it).
3. **Restore lifecycle.** A controlled restore must be crash-atomic: the target must be unstartable from its first
   byte until the controlled-restore transaction commits (e.g. the `RESTORE_CHECK_COPY`-style hold written before
   the database, lifted only by that transaction), and a half-restored target must be recognisable and resumable /
   discardable. The same principle (§14 D-R2-14) was applied to the verification copy but not to the live path.

### 15.2 Other final re-review findings (MINOR, residual)

FA-2 a delegated child held for reconciliation is retained when its delegator ends and a Founder RETRY re-queues it
(reconciliation RETRY bypasses the `enqueueJob` guard) — bounded by the child's budget; FA-3 with ~400 unfillable
waiting requests in a domain each review decision scans them inside its write transaction (~200–350 ms); FA-4 a
need larger than the Work Item's per-run cap never resolves (run caps are immutable; the Founder can cancel); FB-3
docs (closed by `9718e99`); FB-4 a one-word "addressee" before a comma may itself be a read verb ("show, approve goal
X" → a preview needing confirmation); FB-5 some natural-language phrasings now fail closed (UNKNOWN), ":" not
normalised, a closing GOAL noun can override a STAFFING / CONFLICT head noun (the preview names the real act); FB-6
Founder-REJECTED adverse items are disclosed in the profile and monthly claim but not in the readiness reasons, and
INCONCLUSIVE cycles never count toward the retraining bound; FB-7 `command-center serve` on a verification copy
reports `RUNTIME_NOT_READY` instead of the hold reason, and `rollback-update` reports NOT_FOUND.

### 15.3 State of the branch at the stop

- The three families above are **open**; everything else in the frozen register (§8) and in the first re-review
  (§13) is fixed at the root and re-verified, or recorded as a MINOR / Product gap.
- The corrections of the two waves that closed (R2-01 BLOCKER and the other MAJOR families) are sound on their own and
  are recorded in §12 / §14; whether to keep them on this branch, split them, or hold everything until the three
  architecture decisions are made is the Technical Lead / Founder's call.
- Migration 0011 is **unreleased** and still mutable; it is not in `FROZEN_MIGRATIONS`. It must not be released until
  the restore / budget-wait decisions are made (its `budget_wait_needs` table belongs to the open family).
- **READY FOR C7: NO** — three MAJOR root-cause families (money-scheduling, learning-evidence integrity,
  crash-safety of the live restore) are unresolved at the architecture level.
