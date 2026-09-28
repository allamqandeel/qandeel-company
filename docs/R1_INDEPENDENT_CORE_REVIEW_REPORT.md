# R1 — Independent Core Review Report

**Status:** R1 — REVIEW COMPLETE / CLOSURE CANDIDATE — NOT CLOSED

R1 is **not** closed, merged or canonical. It awaits the Technical Lead's exact-head review. C4 is not
started. This report is evidence; it does not close R1 (no `R1_CLOSURE_RECORD` exists).

## 1. Baseline

| Item | Value |
|---|---|
| Canonical `main` at start | `c6a17c30c008e5d5ce04fca86f21b069cce4fe7f` (exact, confirmed after `git fetch`) |
| PR #5 | MERGED (merge commit = the SHA above) |
| Post-merge CI | run `36350272891`, push to `main`, head = the SHA above, **SUCCESS** on `ubuntu-latest` and `windows-latest` |
| Local state before any change | clean tree; local `main` an ancestor of `origin/main` (no unpublished commits); fast-forwarded |
| Branch | `review/r1-independent-core-review`, created from the exact `main` above |
| Toolchain (Founder host) | Node v24.19.0, npm 11.17.0, bundled SQLite 3.53.3, Windows 11 |
| Baseline gates at `c6a17c3` | `npm ci` 0 vulnerabilities; `npm run ci` PASS: 352 tests (storage 212), C1 6/6, C2 19/19, C3 40/40, verifier 49/49 |

## 2. Authority read

Read in full before judging the code: `COMPANY_CANONICAL_BASELINE.md` (privacy Rules A/B/C),
`IMPLEMENTATION_AUTHORITY_RULES.md`, `BOUNDARIES.md`, `IMPLEMENTATION_MAP.md`, the complete
`DECISION_LOG.md` (D-C0 … D-C3-24), `company-architecture/README.md`, the Founding Constitution, the
Strong v1 Master Plan (gates, §8 Definition of Done), Stage 0, 1, 2, 3, 4, 5, 6, 7, 8, 11 (as the review
method), 12, 13 (+ D13 register / handoff), 14 (+ D14), 15 (+ D15) and 17. Stage 9 / 10 were used only
to separate current scope from C4. The C1 / C2 / C3 implementation reports and closure records were
used as an inventory of claims, never as proof.

No imported authority was edited. **No AUTHORITY CONFLICT** was found.

## 3. G1 — Skills

| Skill | Inspected | Used | Effect |
|---|---|---|---|
| `code-review` | yes | **yes** — path-target mode on `packages/` + `scripts/` at `c6a17c3` (no diff existed) | Its finder → verify → sweep structure was mapped onto the R1 dimensions: ten independent adversarial finder angles (R1-A … R1-L + cross-layer seams), each finding verified against the code and by probes, then independent re-review rounds. Its diff-only cleanup angles (reuse / simplification / efficiency) do not apply to a whole-tree review and were not run. |
| `security-review` | yes | **attempted — did not load** | Its bootstrap shell command (`git log … origin/HEAD...`) failed in this Claude Desktop environment. No environment or security setting was changed to force it. Equivalent coverage: the dedicated privacy / security finder angle (R1-K) and the security-focused re-review angles. |
| `simplify` | yes | no | Quality-only; applying cleanups would widen the remediation beyond defect fixes. |
| All other listed skills (UI / React Native / docs / artifacts / scheduling / API …) | yes | no | Not relevant to an independent core review. |

## 4. Review method

1. **FIRST GATE** (§1) and a clean baseline run (§1).
2. **Ten independent adversarial finder angles**, each with its own brief and read-only access plus a
   separate built worktree for empirical probes: R1-A+D identity / authority; R1-B durable work;
   R1-C SQLite / migrations / backup (+ official docs); R1-E routing / privacy / cost; R1-F tools;
   R1-G+H memory / context; R1-I+J skills / academy; R1-K privacy / security; R1-L proof quality;
   cross-layer seams.
3. **Verification** of every candidate (source reading and / or reproduced probe); duplicates across
   angles merged (several MAJORs were found independently by two angles).
4. **Findings recorded before any fix** (commit `3404e4b`).
5. **Remediation** at the root cause, each fix with a regression proof and a mutation that removes the
   fix and must be caught (`scripts/r1-mutation-check.mjs`, run by `npm run ci`, pinned by the verifier).
6. **Independent adversarial re-reviews** of the remediation on exact commits, repeated until a round
   found no BLOCKER / MAJOR: `2ec51f9` (A, B) → `fe45500` (A, B) → `805a1f5` (A, B) → `621d107`
   (A, B). Every defect the re-reviews found was fixed the same way (proof + mutation). The last round
   found no BLOCKER / MAJOR; its one proof gap (the over-bounds attribution line had no committed
   proof) was closed with a proof and a mutation (`r1-09-over-bounds-usage-not-blamed`), which only
   adds a test and a mutation to that head.
7. **Technical Lead exact-head review** of `0ac427e` found one MAJOR follow-up under R1-09 (§8.2.1). It
   was fixed at the root (`3aa458d`), with proofs and mutations, and a fresh focused adversarial
   re-review of that commit covered accounting / health ordering, attribution, routing, crash / restart
   and concurrency.

## 5. Reviewed code surface

Whole implemented core, not only C3: the root workspace and package graph; `packages/domain`,
`storage` (all modules, migrations 0001–0006), `governance`, `runtime` (supervisor, dispatcher, recovery,
wake, health, CLI, C2 model runtime / tool executor / employee task, C3 assembler / proposals / health),
`mind`; all tests (unit, integration, multiprocess, fault, C2 / C3 suites); `scripts/` (C1 / C2 / C3
mutation checks, verifier, test runner, C1 / C2 / C3 acceptance harnesses); `.github/workflows/ci.yml`;
`package.json` / lockfile as supply-chain evidence (0 vulnerabilities, no dependency added by R1).

## 6. Review coverage (R1-A … R1-L)

| Dimension | Result | Evidence (enforcement points / proofs) |
|---|---|---|
| R1-A Identity / ontology | **Holds**; one MAJOR in the lifecycle boundary (R1-11) fixed | `employees` has no model / session / run column; runs link through immutable `run_attributions`; history tables append-only; test "the same Employee works across providers, deployments, sessions, runs and runtime processes". |
| R1-B Durable work | **Holds** after fixes (R1-03, R1-06, R1-08) | Atomic claim (`BEGIN IMMEDIATE` + conditional update), every worker write fenced, terminal-row triggers, bounded crash loops, wake generation advanced by triggers on every QUEUED path. |
| R1-C SQLite / migrations | **Holds**; R1-14 fixed | Each migration one transaction with its row and `user_version` (probed: fault inside 0006, real process exit inside 0006, restart twice); future / drift refused; every table STRICT; deferred-FK failures roll back. |
| R1-D Authority / fail-closed | **Holds** after fixes (R1-04, R1-05, R1-11) | Every Founder write refused without the armed surface (`FOUNDER_SURFACE_UNAVAILABLE`); ACTIVE only through `decideActivation` + datastore gate; self-escalation refused. |
| R1-E Routing / privacy / cost | **Holds** after R1-09 | Privacy gate before cost; D2 external ceiling in five places; class re-derived from durable state; atomic chain reservation (8-process race: exactly 3 of 3); no network / paid call in CI. |
| R1-F Tool authority | **Holds** after R1-02, R1-03 | Drivers reachable only through the Tool Executor, only after the intent commits; stale authority re-checked at every intent; approvals single-use and fingerprint-scoped. |
| R1-G Memory / truth / knowledge | **Holds** after R1-01, R1-12 | Model output only a candidate; provenance / class set by the runtime; canonical truth wins at write and retrieval; corruption sticky; FOUNDER_ONLY never readable. |
| R1-H Context assembly | **Holds** after R1-12, R1-13 | No processor-built messages; minted-context `WeakSet`; reservation bound to an OK manifest of the run; hard budget. |
| R1-I Skills / capability | **Holds** after R1-07 | Pipeline order enforced + DB CHECK; pinned loads with hash verification; SECURITY_HOLD blocks at once; gaps durable, never re-routed. |
| R1-J Academy | **Holds** after R1-10, R1-11 | Critical dimensions not averaged; holdouts never practice; deterministic rubric not overridable; certification never restores ACTIVE by itself. |
| R1-K Privacy / security | **Holds** after R1-01, R1-02 | Logger content-free by construction; failures become fixed codes; audit / event CHECK bounds; no SQL injection (all interpolations are constant identifiers); no listener, no network, no APP-OPS path; Rules A / B / C hold (see P-06). |
| R1-L Proof quality | **Holds** after R1-15 | Per-file vacuity, pinned mutation lists, 40 R1 mutations; remaining lexical limits recorded. |

## 7. Mandatory adversarial scenarios

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Employee survives model / provider / session / process replacement | Holds | C2 runtime identity test; `employees` row version unchanged across three runs, two providers, two runtime processes. |
| 2 | Crash / restart does not duplicate authoritative effects | Holds (+ B-F4 fixed) | C2 fault matrix; FINAL decision checkpointed and honoured on resume (R1 runtime proof). |
| 3 | Two workers race | Holds (+ R1-08 fixed) | Six-process claim race; stale-token processes never win; in-process re-claim after lease loss keeps both runs tracked. |
| 4 | Budget races / failed-call settlement | Holds (+ R1-09 fixed) | 8-process reservation race; possibly-billed calls held, never released; accounting failures contained; settle backstop. |
| 5 | Stale / foreign manifest | Holds | Foreign-run manifest refused at reservation (store + trigger); minted-context check. |
| 6 | Direct provider call without the assembler | Holds | `ModelCallRequest` has no messages; `CONTEXT_NOT_ASSEMBLED`; adapters private; verifier + ESLint confinement. |
| 7 | Tool intent before an authority change, executed after | Holds | Re-check at resume: expired / revoked grant, paused Employee, tool on hold, expired approval all refused (probed). |
| 8 | Certification revoked / expired in flight | Holds | D-C3-18 enforcement at run start, authorization, reservation, tool intent. |
| 9 | ACTIVE reassigned to an uncertified role | Holds (+ R1-11 for PAUSED / ON_LEAVE) | D-C3-24 proofs + R1 proofs. |
| 10 | Skill stale / held after qualification | Holds for load / SKILL requirement; consequence for a certification-pinned version is **P-03** | SECURITY_HOLD blocks loading at once. |
| 11 | Capability gap opened → resolved → resumed without re-routing | Holds (+ R1-07 grant wake) | C3 gap proofs + R1 proof. |
| 12 | Canonical truth changes after a memory / lesson candidate | Holds | Contradicting memory marked INCORRECT, conflicts resolved, lessons / promotions rejected. |
| 13 | Memory conflict corrected while work waits | Holds (+ R1-12 conflict pool) | Same-transaction wake + WAIT-settle re-check; conflict pairs no longer crowded out of the assembly. |
| 14 | External egress with D3 / D4 or an unqualified profile | Holds | Router hard gate + reserving-transaction re-check; D3 / D4 never reached the cloud fake in any probe. |
| 15 | Founder authority through the test seam / a bare reference in production | Holds for production resolution; defence-in-depth gaps recorded (N-SEAM) | Seam unresolvable without the `qandeel-test` condition; bare refs refused. |
| 16 | Restart around v5 → v6, and a second restart | Holds | Probed: injected fault and real process exit inside 0006 → v5, restart applies only 6, second restart nothing; schema equals a fresh v6. |
| 17 | Content-free health / log / audit under failure paths | Holds (+ R1-01 on durable results) | Failure codes only; no message / stack; CLI prints codes; audit CHECK bounds. |
| 18 | Direct storage / facade bypass of governance | Two bypasses found and fixed (R1-04, R1-05) | See findings. |

## 8. Findings

### 8.1 BLOCKER

None in the canonical core. One BLOCKER was **introduced by the first remediation** (catastrophic
backtracking in the widened secret detector, reachable inside write transactions); the re-review found
it and it was fixed before this report (see R1-01).

### 8.2 MAJOR — all VERIFIED FIXED

Mutations are in `scripts/r1-mutation-check.mjs` (each must be caught; 40 / 40 caught).

| ID | Finding | Root cause | Fix | Proof / mutation | Re-review |
|---|---|---|---|---|---|
| R1-01 | Secret material: common credential formats undetected (stored as memory, sent to providers); tool results stored raw; claim values unscanned; step results truncated before scanning | A narrow 7-pattern denylist; the C2 tool-result write and claim fields never scanned | Wider detector on NFKC / invisible-folded text; bounded, linear patterns; scan cap 16 384; value must be credential-shaped; tool results withheld as a digest; step results get the credential-named-key guard; claim fields scanned; secret instructions refused before any provider call | `mind/test/r1-kernel`, `storage/test/r1-review`, `runtime/test/r1`; mutations `r1-01-*` (5) | Re-reviews found and got fixed: super-linear backtracking (BLOCKER, introduced), prose false positives (MAJOR, introduced), step-result key gap (MAJOR). Final round: none. |
| R1-02 | Model-proposed tool arguments named after `Object.prototype` members skipped strict validation and reached drivers / approval fingerprints | Plain-object lookup on untrusted keys | Own-property lookup; prototype-member schema names refused; null-prototype canonical JSON | governance + storage proofs; `r1-02-tool-args-inherited-field` | Holds. |
| R1-03 | A re-released / reworked Work Item's new job reused step-0 idempotency keys: stale REPLAY or false `IDEMPOTENCY_CONFLICT` counting toward the authority pause | Keys per Work Item, loop step per job | Durable per-job step base (job ordinal × 100; first job 0 → existing keys unchanged); typed `STEP_RANGE_EXHAUSTED` past the durable bound, before any effect | storage + runtime proofs; `r1-03-step-base-ignored`, `r1-03-step-range-unbounded` | Holds. |
| R1-04 | C1 `resolveReconciliation` (opaque actor) completed governed work and released dependents while the C2 tool invocation and its money stayed held | C2 never brought the C1 entry point under Founder authority | Governed jobs: Founder-authority write (fail closed in production), only after the uncertain tool invocation is resolved | storage proofs; `r1-04-governed-reconciliation-unauthenticated` | Holds. |
| R1-05 | Approval released work whose dependencies were unfinished | C2 release path duplicated C1 release without the dependency check | Approval-bound work with unresolved dependencies goes BLOCKED(DEPENDENCY) and is released by the ordinary dependency path | storage proof; `r1-05-approval-releases-unresolved-dependencies` | Holds. |
| R1-06 | Approval / budget decided while the job was still CLAIMED: work parked forever (lost wake) | C2 waits lacked the settle re-check C3 waits have | WAIT settle re-checks the durable predicate (no pending approval, or one decided during the run; a cap raised since the run began) | storage proofs; `r1-06-*` (2) | Re-review refined the approval predicate (stale PENDING from an earlier job). Holds. |
| R1-07 | Issuing the missing grant never woke a `TOOL_ACCESS_MISSING` gap | Grant write not wired to the gap wake | Grant wakes the Employee's open gaps in the same transaction | storage proof; `r1-07-grant-does-not-wake-gap` | Holds. |
| R1-08 | After an in-process lease loss the re-claimed run's registry entry was deleted by the old run: live processor escaped cap / cancel / stop | Registry keyed by job | Keyed by run; interrupted local run fenced before re-claim; shutdown interrupts only claims it still holds | runtime proof; `r1-08-active-runs-keyed-by-job` | Holds. |
| R1-09 | A post-call accounting error escaped the model runtime: reservation left RESERVED, deployment not held, same route retried | No containment after the provider answered | Containment holds the money; provider fault decided from the answer (never from a local error); best-effort health writes; settle backstop holds any RESERVED model reservation | runtime + storage proofs; `r1-09-*` (13) | Re-reviews refined attribution (local contention not blamed; over-bounds usage blamed, with its own proof). The Technical Lead exact-head review found the containment not durable across the accounting → health boundary (MAJOR, §8.2.1) — fixed. |
| R1-10 | Academy refusals hidden by voiding (new attempt / withdrawal) and by cancelled shadow work | Refusal scoring existed in one of three closure paths | One closure helper scores refusals first; cancelled / superseded shadow refusals collected; closed attempts' work cancelled | storage proofs; `r1-10-*` (3) | Holds. |
| R1-11 | A PAUSED / ON_LEAVE Employee reassigned to an uncertified role resumed ACTIVE duty in it | D-C3-24 demotion only for ACTIVE | PAUSED → RETRAINING (existing transition); ON_LEAVE role change without the target certification refused (fail closed; **P-01**) | storage proofs; `r1-11-*` (2) | Holds. |
| R1-12 | Ineligible memories / knowledge crowded eligible ones out of the bounded pool | Eligibility applied after the SQL `LIMIT` | Separate bounded pools: eligible (decided before the LIMIT), rejection evidence (keeps `DATA_CLASS_ABOVE_CONTEXT` / `MARKET_MISMATCH` / `STALE` / `CONFLICT_UNRESOLVED` in the manifest, D-C3-06), and conflicts that can hold the work | storage proofs (floods of every kind, CONFLICT_HOLD under floods); `r1-12-*` (6) | A first version dropped rejection evidence (3 C3 proofs failed — treated as a regression and fixed, no test changed); re-reviews found knowledge staleness and two conflict-pool crowd-outs (MAJOR — fixed). Final round: none. |
| R1-13 | Model-authored memory could forge higher-layer markers in the provider-bound context | Lower-layer text rendered verbatim | Length-preserving, linear neutralization of marker / header / precedence lines (Unicode spacing, format characters, full-width forms, any decimal digit) | mind + storage proofs; `r1-13-lower-layer-forges-marker` | Re-reviews widened coverage. Residual bounds recorded (N-NEUT). |
| R1-14 | Released migrations 0005 / 0006 not frozen by content | Verifier list not extended at C3 release | Frozen by content with violation self-tests | verifier self-tests | Holds. |
| R1-15 | An emptied proof file or a hollowed mutation script kept CI green | Run-wide vacuity; mutation scripts unpinned | Per-file passing-test requirement; `mutation-checks-pinned` (IDs, machinery, no exit before the loop); bootstrap workspace on the vacuity runner | runner negative test; verifier self-tests | Lexical limits recorded (N-PROOF). |

### 8.2.1 Technical Lead exact-head review — MAJOR follow-up under R1-09 (VERIFIED FIXED)

Reviewed head `0ac427e531b1f5060e95f6a4d9fdeb1a1769b03c` (PR #6 comment). Engineering finding, not a
Product decision.

| Step | Record |
|---|---|
| Finding | A provider answer whose usage is outside the enforced bounds is a known contract violation. The money settlement committed in one transaction; the deployment `CONTRACT_VIOLATION` hold was a second, best-effort transaction whose failure (local contention) was swallowed. `#account` returned `OK`, the deployment stayed `ACTIVE`, and routing (which gates on deployment / provider status) could select it again. Nothing turned `usage_records.within_bounds = 0` into a hold. The same split existed for a malformed answer (contract violation without usage) and for the containment after a failed settle. |
| Root cause | The durable evidence of the provider fault (the money / usage record) and the durable containment (deployment status) were written by separate transactions, and only the first was fail-closed. |
| Fix | **One transaction for both.** A fenced model-call settle whose usage is outside the bounds contains the reservation's own deployment inside the settle transaction (`txSettle`): the out-of-bounds usage row and the HOLD commit together or not at all. A new fenced `containProviderFault` holds the money (if still reserved) and contains the deployment atomically; it is used for unusable usage, a malformed answer, and the containment after a failed settle. The deployment is always the reservation's own, never the caller's. **Attribution unchanged:** a healthy answer's health is still best effort, and local-only failures never hold or blame the provider. **Store refuses everything:** if even the containment write is refused, nothing durable names the provider; the process keeps that deployment out of routing and writes the containment at the next route boundary, and the money is held by the existing hold / run-settle backstop / recovery. A failed call that reports over-bounds usage is now a contract violation too (no same-route retry; resolves the earlier attribution asymmetry). No new table, migration or routing system: the existing reservation, usage record, deployment status, fences and reservation-time eligibility gate carry it. |
| Regression proofs | Runtime (`r1-runtime.test.ts`, "R1-09 (Technical Lead follow-up)"): (1) settle + known fault + HOLD write fails once → deployment `HOLD`, violator called once, money `RECONCILIATION_REQUIRED`, next Work Item never routed or reserved there, still true after a restart; (2) healthy provider + health write fails once → `ACTIVE`, `SETTLED`, still routable; (3) malformed answer + containment write fails once → `HOLD`, held; (4) money write and containment both refused → violator not called again, contained at the next route boundary. Storage (`r1-review.test.ts`): the out-of-bounds settle and the HOLD roll back together (no usage row, still `RESERVED`) and commit together; the contained deployment is refused at the reservation gate (`ROUTE_NO_LONGER_ELIGIBLE`); `containProviderFault` is atomic; a healthy settle never touches deployment health. Proof (1) was run against `0ac427e` with only the new fault point added: it fails ("contained although the health write failed"); proof (2) passes on both. |
| Mutations | `r1-09-provider-fault-hold-not-durable` (restores the `0ac427e` split), `r1-09-malformed-answer-hold-split`, `r1-09-uncontained-violator-routable` — all caught. `r1-09-store-contention-blamed-on-provider` and `r1-09-accounting-failure-escapes` were re-targeted to the moved containment method with the same meaning (still caught). |
| Re-review 1 (`3aa458d`) | A fresh focused adversarial re-review (accounting / health ordering, provider-vs-local attribution, routing consequence, crash / restart, concurrency) confirmed the fix for the Technical Lead's case, and found **one more MAJOR on the same boundary**, reproduced: a failed call the provider classified `CONTRACT_VIOLATION` that also reported within-bounds usage settled the money (`FAILED_CHARGED`) without the containment. The HOLD then went through the best-effort health write, so a failed write left the violator `ACTIVE`, and the C1 retry called and paid it again. **Fixed:** the runtime's provider-fault verdict is carried into the settle transaction (`settleReservation(…, providerFault)`), so a charged contract violation settles and contains together, and no separate health write follows. MINORs fixed at the same time: an over-bounds charged failure no longer counts twice toward the deployment circuit; the in-process routing exclusion has its own proof (the next-route containment write refused too). Proofs: a charged contract violation with the containment write failing once (not called or paid again, `HOLD`); an over-bounds charged failure (one circuit count, no same-route retry, `SETTLED`); refused next-route containment (never routed). Mutations: `r1-09-charged-violation-verdict-dropped`, `r1-09-uncontained-filter-removed`. |
| Re-review 2 (`59449c2`) | A second fresh focused re-review found **no BLOCKER / MAJOR**. It ran a 52-scenario matrix (every failure class × charged within bounds / charged over bounds / charged unusable / uncharged, each with one refused containment write): every known fault ended contained, held and called once; no healthy contract was blamed; money was never left reserved or released; two concurrent violating runs gave one HOLD and clean accounting invariants. Two MINORs were **fixed**: (1) an answer object whose `usage` getter throws escaped `call()` and caused blind paid retries (predating this follow-up); the answer is now snapshotted once inside the adapter boundary, and a misbehaving answer object is the provider's contract violation; (2) two single-branch mutants survived (the unusable-usage branches); each branch now has its own proof, with one refused containment write, and a single-occurrence mutation. Mutations: `r1-09-unusable-usage-hold-split`, `r1-09-charged-unusable-usage-not-contained`, `r1-09-lazy-answer-read-escapes`. Notes kept as residual (N-HEALTH): next-route containment is attributed to the next run; an in-process-only exclusion is lost on restart before it is written. |
| Final re-review (`b0ac2b7`, after exact-head validation passed) | Found **one MAJOR, reproduced**: the answer snapshot copied only the usage object's reference, so the fault check and the settlement read its fields separately. A shifting getter (valid on the first read, throwing on the second) plus ONE refused containment write left the violator `ACTIVE`, and the same Work Item and the next one called and paid it again. **Fixed at the root:** the usage VALUES are snapshotted once at the adapter boundary, so every later decision sees the same numbers. This also closes the reviewer's F2, the same root cause: usage over the bounds on the first read and within them later was never contained. Proofs: shifting usage plus one refused write (called once, `SETTLED` on the values checked); over-then-within-bounds usage (contained). Mutation: `r1-09-usage-snapshot-shallow`. Per the Product / Technical Lead closure rule, the validation gate was invalidated and re-run. MINORs from this round are recorded as residuals, not fixed (N-ADAPTER). |

### 8.3 MINOR

**Fixed in R1:** K4 proposal codes length-bounded (poison settle); B-F4 FINAL checkpoint honoured on
resume; G-4 D4 retention at decision time; C-F5 malformed backup manifest keeps its error code; AC-F5
closed attempt's work cancelled; L-4 bootstrap tests on the vacuity runner; B-F6 D-C2-07 wording read with
D-C2-12 (decision log note).

**Recorded, not changed (residual):**

| ID | Residual |
|---|---|
| N-DET1 | Secret detection is a denylist: digit-free prose passwords (`password: hunter-two-horse`), `pwd=` / `PIN:` forms, "number-word" values (`2024-Summer`) and non-English / non-Arabic keywords are not caught by the text rules (precision / recall trade-off; structured results are still guarded by credential-named keys). |
| N-DET2 | The verifier's repository secret scan (`no-plaintext-secrets`) keeps its original, narrower list. |
| N-NEUT | Neutralization bounds: ≤ 64 prefix characters, 1–8 separators and ≤ 128-character ids in item headers; compatibility letters, look-alike brackets (`【` `〔`), full-width header words; reference context still uses the `system` role. |
| N-POOL | When more than 300 more-relevant in-class conflict pairs exist, the manifest may not name a specific pair (the hold still triggers). |
| N-KEYS | A pre-R1 governed job that is not its Work Item's first job and is in flight across the upgrade would present new keys (no such workspace exists; only validation workspaces). |
| N-HEALTH | Health-write failures for healthy answers are not logged (best effort by design). The in-process exclusion of a violator whose containment the store refused is per process: another process learns of it only when the containment is written, and a restart before that loses it (nothing durable names the fault until then; the money is held as `SETTLEMENT_FAILED` / `RUN_ENDED_UNSETTLED`, not a provider code). A containment written at the next route boundary is attributed to that run in audit / history. A provider hold for `AUTH` / `BILLING` / `QUOTA` / `MODEL_DEPRECATED` (never billed per the dispositions) stays best effort; if such a failure also reports usage, the charge is settled and the provider hold is still best effort. This predates R1; whether invariant A's "provider fault" covers these is a Technical Lead call. |
| N-SEAM | The test seam's load guard reads `NODE_OPTIONS` and its arm internals are a module export (in-process defence in depth). |
| N-ART | A run artifact fence can be rebuilt from the ordinary API; `putRunArtifact(jobId)` is public. |
| N-MIND | Memory / context writes are not refused after a mid-run lifecycle withdrawal (nothing leaves the process or is spent). |
| N-ACAD | `startAttempt` has no actor authority (holdout exposure before the budget check); shadow work may use a plain processor kind; evidence epoch stamped at collection; static inspection is a lexical deny-list; AUTHORITY_COMPLIANCE `passPct` has no floor (Product nature); Academy cost uses SQL `SUM`. |
| N-TOOL | A rejected R3 request can be re-requested with changed arguments within `maxTurns`; `tool.action` capability strings can collide through dots (R0 / R1 only). |
| N-COST | Storage does not recompute a model reservation's worst case from the price card; escalation evidence is asserted by the (runtime-owned) processor; escalation "from" uses the configured, not the routed, class. |
| N-DB | Append-only guarantees rely on triggers (REPLACE would bypass them; not used anywhere); three small tables have no append-only trigger; backup verify → restore copy is not re-hashed; a backup is recorded before its full verification. |
| N-WORK | Optional-review rework after dependents were released is not guarded. |
| N-ADAPTER | (Final re-review F3, MINOR.) A thrown `ProviderError` whose own `usage` / `failure` getter throws still escapes `#call`. The run fails retryably, the same route is called again, and the money is held; the deployment is not contained. The error object's reads are not yet guarded or snapshotted like the answer's. Only reachable through a misbehaving adapter (the only adapter today is the deterministic fake). (F4, MINOR, by design.) An in-process exclusion whose containment the store refused is lost on a crash before the next route boundary; nothing durable recorded the violation. Recorded under the closure-cycle rule: MINOR, no code change in this cycle. |
| N-PROOF | Linearity proofs use wall-clock limits (500 ms / 1 000 ms; ~250 ms measured) and could flake on a heavily loaded host; mutation catch = any listed test failing; acceptance "no CLI command" checks exit code only; acceptances are not in `npm run ci` (they are in GitHub CI); race tests do not prove overlap; the mutation pin is lexical. |

### 8.4 PRODUCT OWNER DECISION REQUIRED

None of these is decided by R1. Each keeps the current fail-closed or bounded behaviour until decided.

| ID | Question | Current behaviour | Blocks R1? |
|---|---|---|---|
| P-01 | Role reassignment of an `ON_LEAVE` Employee (no `ON_LEAVE → RETRAINING` transition exists) | Refused when the target-role certification is missing (fail closed) | **Non-blocking** — fail closed; Founder writes are unavailable in production until C5. |
| P-02 | Should automatic containment (Stage 3 §9) also apply to trainees (TRAINING / SHADOW / PROBATION / RETRAINING)? | Trainees are not paused; every refusal is scored as a critical AUTHORITY_COMPLIANCE failure; trainees cannot run external / mutating / R3 actions | **Non-blocking** — constrained execution already limits blast radius. |
| P-03 | Consequence of `SECURITY_HOLD` / `RETIRED` on a skill version pinned by a VALID role certification; evidence to lift a hold | Held versions never load; SKILL requirements gate; the certification stays VALID | **Non-blocking** — no held skill reaches a prompt; latent until skills are administered (C5). |
| P-04 | Who may start a step above the Cognitive Profile's default reasoning class, and is it escalation overhead? | The submitter may, within the Employee ceiling and the policy maximum | **Non-blocking** — bounded by ceilings and budgets. |
| P-05 | Does an IMPORTANT memory-conflict hold also gate a pending tool execution (not only inference)? | Only inference is gated; tool execution passes the full authority path | **Non-blocking** — authority is still enforced at the action boundary. |
| P-06 | Are unsalted content hashes in local operational records (artifact SHA-256 in audit; context-manifest item hashes in CLI output) content-free under Rule A? | Kept; no telemetry leaves the machine (no APP-OPS path, C7) | **Non-blocking** for R1; must be decided before C7 / any telemetry export. |

Carried from C3 (already recorded as open, D-C3-23 #2 / #3): calibration at recertification of an ACTIVE
designated-role Employee; whether post-EXTEND evidence must come from post-extension work. Non-blocking.

## 9. Remediation diff summary

| Area | Files |
|---|---|
| Domain | `validation.ts` (null-prototype canonical JSON, `hasSecretNamedKey`) |
| Governance | `tools.ts` (own-property argument validation), `proposals.ts` (bounded codes) |
| Mind | `text.ts` (secret detector), `context.ts` (layer-marker neutralization) |
| Storage | `governed-writes.ts`, `runtime-authority.ts`, `mind-writes.ts`, `governance.ts`, `store.ts`, `academy.ts`, `backup.ts` |
| Runtime | `runtime.ts` (global steps, run-keyed registry, shutdown), `c2/model-runtime.ts` (accounting containment, provider-fault attribution), `c2/employee-task.ts` (FINAL checkpoint, secret instructions) |
| Proofs | `governance/test/r1-kernel.test.ts`, `mind/test/r1-kernel.test.ts`, `storage/test/r1-review.test.ts`, `runtime/test/r1/r1-runtime.test.ts` |
| Proof machinery | `scripts/r1-mutation-check.mjs` (40 mutations), `scripts/run-node-tests.mjs` + `scripts/test-file-counter.mjs` (per-file vacuity), `scripts/verify-bootstrap.mjs` (0005 / 0006 frozen, `mutation-checks-pinned`), `scripts/c3-mutation-check.mjs` (one mutation re-targeted to the R1-11 form of the same gate), `package.json` (`r1:mutation` in `ci`), `packages/bootstrap-contract/package.json` |
| Docs | this report; `DECISION_LOG.md` D-R1-01; `IMPLEMENTATION_MAP.md` (R1 row only) |

No migration was added or edited. No dependency was added. No C4–C7 scope, APP integration, Pilot work
or Stage 16 reconstruction.

## 10. Final validation

Founder host (Windows 11, Node 24.19.0, npm 11.17.0), on the final branch head (the commit that adds
this validation; its code equals `621d107` plus one R1-09 proof and one mutation). `621d107` itself
also passed the full `npm run ci` twice (Founder host and re-review B's own worktree: 424 tests, R1
30/30) and the three acceptances.

| Gate | Result |
|---|---|
| `npm ci` | exit 0, 0 vulnerabilities |
| `npm run ci` | **PASS** (build, typecheck, lint, tests, C1 / C2 / C3 / R1 mutations, verifier) |
| Tests | **425 passed**, 0 failed / skipped / todo — bootstrap 5, domain 22, governance 36, mind 53, storage 241, runtime 68 |
| Mutations | C1 6/6, C2 19/19, C3 40/40, **R1 31/31** |
| Verifier | 221 files, 50/50 rules passed; self-test: 49 rules each proved able to fail |
| C1 acceptance | **PASS** — 6 steps (external workspace outside any git tree) |
| C2 acceptance | **PASS** — 8 steps |
| C3 acceptance | **PASS** — 9 steps |
| `git diff --check` | clean |

Count changes vs the C3 reference (352 / storage 212 / 6 / 19 / 40 / 49): +73 tests (governance +11,
mind +26, storage +29, runtime +7 — all new R1 proofs); R1 mutation suite added (31); verifier +1 rule
(`mutation-checks-pinned`). No existing test was weakened; one C3 mutation was re-targeted to the R1-11
form of the same gate.

## 11. Official-source check

Read (angle R1-C): nodejs.org Node 24 `sqlite` (`defensive` default true since v24.14.0; `timeout`;
`isTransaction`; `readBigInts:false` → `ERR_OUT_OF_RANGE`; `backup()` rate per step), sqlite.org
`lang_transaction`, `foreignkeys` (deferred FKs; `PRAGMA foreign_keys` no-op in a transaction),
`lang_conflict` (REPLACE skips delete triggers unless `recursive_triggers`), `pragma` (`quick_check` vs
`integrity_check`, `trusted_schema`, `recursive_triggers` default OFF), `wal`, `stricttables`, `backup`.
Every feature the core relies on is used compatibly; the only material observation is the REPLACE /
trigger interaction (N-DB; no `REPLACE` exists in the code).

## 12. Verdict

**R1 INDEPENDENT CORE REVIEW — CLOSURE CANDIDATE / NOT CLOSED**

No unresolved BLOCKER, no unresolved MAJOR, no blocking Product decision. The final independent
re-review round (A and B) on the exact remediation head `621d107` found no BLOCKER or MAJOR; the only
later code change is one added proof and its mutation. R1 is not closed; C4 is not
started; Technical Lead exact-head review is required.
