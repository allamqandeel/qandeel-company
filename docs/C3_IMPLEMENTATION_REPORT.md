# C3 — Memory + Context + Skills + Academy — Implementation Report

> **C3 — IN PROGRESS — Cloud implementation candidate. NOT CLOSED.** Nothing here is a closure
> record. C3 closes only after final independent review and Founder-host validation (§14). R1 is NOT
> STARTED; C4 is NOT STARTED.
>
> **Founder Decision closure (§16).** After an independent review of `c8cbebf` found no new engineering
> BLOCKER or MAJOR, the Founder decided the D-C3-17 Product questions. They are implemented on this
> same PR as D-C3-18 .. D-C3-22.

## 1. Baseline, branch, PR

- **Baseline:** `main @ f9bd7d4d817b20ea5911fd566c21b5288eec5b7b`. C1 and C2 are CLOSED / MERGED /
  CANONICAL. The C2 post-merge CI (run 36309634255, attempt 2) passed on Windows and Ubuntu. The
  tree was clean at start, and `main` had not moved.
- **Branch / PR:** `claude/eager-cray-vmv69o`, one Draft PR
  ([allamqandeel/qandeel-company#4](https://github.com/allamqandeel/qandeel-company/pull/4)). It is
  not to be merged by this task.
- **Lifecycle records:**
  - IMPLEMENTATION_MAP and README say C3 IN PROGRESS / Cloud implementation candidate.
  - C1 and C2 remain CLOSED.
  - R1 remains NOT STARTED.
  - No C3 closure record exists; the verifier rule `c3-not-claimed-closed` enforces this.

## 2. Authority read

Read in full before any edit:
- Stage 1 Constitution, 2 Ontology, 3 Authority / Risk / Governance;
- Stage 4 Employee Identity / Lifecycle, 5 Memory / Knowledge, 6 Academy / Training / Certification;
- Stage 7 Skills / Tools / Capability, 8 Work OS, 12 Local-first Runtime;
- Stages 13–15 closures, registers and handoffs (D13-E assigns context assembly / budgets / manifest
  to C3);
- Stage 17, where it touches memory / telemetry;
- the canonical baseline, implementation authority rules, implementation map, boundaries;
- the C1 / C2 documents, closure records and decision log.

Findings:
- **No AUTHORITY CONFLICT was found.**
- Stage 16 (Founder Command Center) is missing and was not reconstructed. C3 builds no Founder UI or
  authentication.
- Interpretations and open questions for the Product Owner are in DECISION_LOG D-C3-17 and §13.

## 3. Skills and official research (G1)

- **Skills inspected:**
  - the session's installed Skills list;
  - `.claude/` in the repository, which holds no project Skills.
- **Skills used:** none. No installed Skill covered this repository's governed C3 work, so none was
  used. None was invoked merely to satisfy this report.
- **How reviews were done instead:** by focused review subagents (§11), which are not Skills.
- **Official research** (D-C3-15):
  - The Node.js `node:sqlite` documentation (Stability 1.2) was re-read. C3 uses no SQLite or
    `node:sqlite` feature beyond C1 / C2: STRICT, CHECK, triggers, partial / unique indexes,
    `json_valid` / `json_each`, and deferrable foreign keys.
  - FTS5 is present in the bundled SQLite 3.53.4 but deliberately not used.
  - `sqlite.org` is not reachable from the Cloud session (as in C1 / C2). The Founder-host review
    re-reads the relevant pages there.
- **Out of scope by design:** no embedding or model provider, no vector database, and no paid memory
  or Skill service was researched or used.

## 4. Architecture summary

| Package | C3 role |
|---|---|
| `@qandeel-company/mind` (new, pure, no I/O) | Memory Write Policy; Arabic-normalized lexical retrieval; context planner / renderer (layers, hard budget, canonical binding); extractive compaction; Skill licence classification, static inspection, eligibility, directive conflicts; capability evaluation; Academy rules (critical dimensions, diagnosis, probation, certification gaps, time-aware status) |
| `@qandeel-company/storage` | Migrations 0005 / 0006. `MemoryStore`, `SkillStore`, `AcademyStore`, `CapabilityStore` (Founder authority, deterministic system steps, reads). Fenced runtime writes behind `runtime-authority`: `assembleContext`, `submitMemoryCandidate`, `decideMemoryCandidate`, `decidePendingCandidates`, `recordStepResult` |
| `@qandeel-company/runtime` | Context Assembler (mints frozen contexts); memory-proposal path; the capability gate at run start → `WAIT CAPABILITY_GAP`; recovery of pending candidates; content-free `mind` health; read-only CLI `mind`, `capability-gaps`, `context-manifest` |

- **Identity boundaries kept:**
  - Employee ≠ Model ≠ Session ≠ Run ≠ Process.
  - Session ≠ Memory: memory is durable Employee state, never provider-session state.
  - Skill ≠ Tool ≠ Authority.
  - Canonical Truth outranks memory, at write time and at assembly.
- **Dependencies:** no third-party dependency was added (§12).

## 5. Memory / Context design (D-C3-03..07)

- **Memory classes:** CURRENT_WORK, EXPERIENCE, PROFESSIONAL, RELATIONSHIP_COLLABORATION and
  PERSONAL_LESSON. Company Knowledge and Canonical Truth are separate tables.
- **Model output is only a candidate.** Each proposal takes two transactions:
  1. **Submit** (fenced, idempotent). The runtime sets provenance `run:<id>`, the evidence and the
     data-class floor; the model sets none of them.
  2. **Decide.** The runtime-owned policy decides.
- **What the policy refuses or holds:**
  - Secrets are refused, and their content is not stored.
  - Confidence is capped by class, and capped lower without evidence.
  - Exact and near duplicates are refused.
  - A claim that contradicts Canonical Truth is refused.
  - When two memories disagree, a durable conflict is opened; both memories are kept and both are
    held from context.
  - D4 context is never retained.
- **Crash recovery.** Recovery decides each candidate left SUBMITTED by a crash, one per transaction.
  A tampered candidate is refused with `INTEGRITY_FAILED`.
- **Integrity and staleness.**
  - Every load re-verifies the content hash; a mismatch marks the record CORRUPT, audits it, and the
    record is never used.
  - A memory past its review horizon becomes STALE and is excluded. Exact re-observation, or the
    Founder, re-validates it.
- **Learning path:** OBSERVATION → nomination → LESSON_CANDIDATE → review → VALIDATED → promotion.
  - The independent review is C4; in Strong v1 the Founder decides, so production fails closed.
  - Shared promotion waits for review, is unique per target, and refuses D3 / D4 content.
- **Knowledge scopes** (COMPANY / DEPARTMENT / ROLE / MARKET / RESTRICTED / FOUNDER_ONLY) are filtered
  in SQL at retrieval time. An unauthorized item is never a candidate, so it never appears in a
  manifest, summary or error.
- **Mandatory governed Context Assembly.** Every inference goes through it.
  - `ModelCallRequest` carries no messages.
  - The runtime assembles each step's context in one fenced transaction and mints a frozen value.
  - `GovernedModelRuntime.call` refuses any context it did not mint (`CONTEXT_NOT_ASSEMBLED`).
  - Every `MODEL_CALL` reservation names the step's OK manifest; a datastore trigger checks this too.
- **Layers, highest precedence first:**
  - L1 AUTHORITY: preamble, Canonical Truth.
  - L2 WORK: Work Item instructions, Academy scenario.
  - L3 SKILL: pinned, eligible Skill versions.
  - L4 KNOWLEDGE.
  - L5 MEMORY: own memories, compaction summaries.
  - L6 RECENT: durable step results recorded by the runtime's own services. Only the newest is
    required.
- **Hard budget.**
  - Defaults: 24 000 tokens; per Work Item 1 024..64 000; fixed layer shares.
  - Required items that do not fit give `CONTEXT_BUDGET_EXHAUSTED`, never silent truncation.
  - Full history is never loaded: pools come from a term index, are bounded (memory 300 /
    knowledge 200 / canonical 200) and are deterministic.
  - Canonical claims bind structurally, whether or not the canonical statement itself is loaded.
- **The manifest** records the IDs, versions, hashes, classes, provenance and reason codes of every
  selected and rejected item, never content. It is written for refused assemblies too.
- **Effect on the Work Item's data class.** An admitted item's data class raises the Work Item's
  effective class. That class binds routing, reservation and tool egress for the rest of the Work
  Item.
- **Held work:**
  - IMPORTANT work on a memory conflict waits `MEMORY_CONFLICT_REVIEW` and is woken in the same
    transaction as the resolution.
  - Conflicting Skill directives wait `SKILL_CONFLICT_REVIEW`.
- **Compaction** produces extractive, attributed, fingerprinted summaries built from query-independent
  sources. Any change to a source invalidates them. Summaries are never truth: they rank as memory.

## 6. Skill / Capability design (D-C3-08, D-C3-09)

- **Supply chain:** DISCOVERED → INSPECTED → LICENSE_DEPENDENCY_CHECKED → SECURITY_QUARANTINE →
  SANDBOXED → BENCHMARKED → COMPARED → APPROVED, or REJECTED with its reason kept.
  - Inspection and the licence check are deterministic.
  - Every other step is Founder authority with evidence.
- **Licences:**
  - Clearly permissive licences (MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, CC0-1.0) clear
    automatically.
  - The Unlicense (Founder Decision D-C3-21) and licences with obligations (CC-BY, copyleft,
    share-alike) wait for a recorded licence review.
  - This is a Product risk posture, not a legal conclusion.
  - Unknown or missing licences are rejected.
  - A paid dependency is flagged `FREE_SKILL_PAID_DEPENDENCY` and needs an explicit acknowledgement.
  - There is no marketplace and no paid pack.
- **Loading:** only pinned, eligible, hash-verified versions load, through one loader.
  - SECURITY_HOLD blocks at once.
  - DEPRECATED only degrades.
  - Executable content and authority / governance directives fail inspection.
- **Skill ≠ Tool ≠ Authority.** A Skill's requested tools grant nothing, and a tool grant never
  satisfies a Skill requirement.
- **Updates:**
  - The impact set is computed, and rollout / rollback repin.
  - Recertification scope matches the change: an unchanged blueprint does not trigger it; TARGETED
    re-tests the Skill; PARTIAL / FULL mark the certification REVIEW_DUE.
  - Discovery intake is deduplicated.
- **Capability requirements** (SKILL / CERTIFICATION / MARKET / TOOL) only add gates.
  - The gate runs at fenced run start, before any model or tool call.
  - A gap is durable and parks the work at zero tokens; the work is never re-routed.
  - The WAIT settle re-checks the gap.
  - Certification, passport and Skill changes wake the parked work through the durable wake
    generation, with no polling.
  - A cancelled gap ends the work, typed and audited.

## 7. Academy / Certification design (D-C3-10..12)

- **Programs** are versioned and bound to the role's ACTIVE blueprint, and cover the core curriculum.
- **Path:** LEARN → CASE_STUDIES → SIMULATION → FEEDBACK → (RETRY) → ASSESSMENT → SHADOW_WORK →
  PROBATION_REVIEW → CERTIFICATION → ACTIVATION_APPROVAL. Repeated critical failure leads to BLOCKED.
- **Attempts** are real Work Items run by the runtime in `ACADEMY_ATTEMPT` constrained mode, whoever
  takes them.
  - Constrained mode allows no external egress, no external mutation and no R3 actions.
  - The scenario is served through the assembler, and every exposure is recorded.
  - An attempt that never completed is VOID and never scored.
- **Scoring:**
  - AUTHORITY_COMPLIANCE and COST_DISCIPLINE come only from run facts. Every refusal counts.
  - The other dimensions come from the evaluator, who is never the trainee.
  - A critical-dimension failure fails the attempt whatever the average.
  - Holdouts are never practice, and an exposed holdout never certifies.
- **Evidence windows.**
  - A probation FAIL is diagnosed into remediation, opens a new evidence epoch, and returns through
    RETRY to new shadow work.
  - EXTEND opens a new review round, and the next review needs at least one new evidence item
    recorded after the extension (D-C3-20).
  - An activation REJECT withdraws the enrollment; the Employee may enroll again.
- **Certification** is role-specific and time-bounded. It pins exact, rolled-out Skill versions and
  can move to REVIEW_DUE or be revoked. Concurrent issuance produces exactly one certification
  (multi-process proof). Founder Calibration is not a certification prerequisite (D-C3-19).
- **Losing certification (D-C3-18).** If an ACTIVE Employee's current-role certification is REVOKED or
  has EXPIRED by the clock, the Employee moves to RETRAINING at the next ordinary-duty boundary (or at
  once on revocation) and starts no ordinary work. REVIEW_DUE keeps the Employee ACTIVE and blocks only
  work that requires that certification.
- **C2 activation bridge — status: FAIL-CLOSED in production, as required.**
  - `decideActivation` is Founder authority. It re-checks every piece of evidence: a VALID same-role
    certification, a PASS probation review for the current round, an unexpired certification and, for
    a designated role, an APPROVED Founder Calibration of the same enrollment (D-C3-19). Only then does it set ACTIVE, with `academy:` / `probation:` /
    `activation:` references.
  - Until the authenticated Founder surface exists (C5), it returns `FOUNDER_SURFACE_UNAVAILABLE` in
    production.
  - The trigger `employees_activation_gate` refuses every other path to ACTIVE; it also requires an
    enrollment's Founder Calibration, when one exists, to be APPROVED and recorded on the request. The
    C2 test seam is unchanged and test-only.

## 8. Migrations

| # | File | SHA-256 (LF) | Content |
|---|---|---|---|
| 1–4 | C1 / C2 (unchanged) | pinned; frozen by content (`released-migrations-frozen`) | — |
| 5 | `0005_c3_memory_context.sql` | `2c2f0d8092f108de2596c15e795ba6ba8d17b316761d0ac59e45d8845409e44a` | canonical truth, memory candidates / records / history / conflicts / corrections, lessons / promotions, knowledge, `mind_terms`, context manifests / entries, `context_step_results`, compaction summaries, `budget_reservations.context_manifest_id` + manifest trigger |
| 6 | `0006_c3_skills_academy.sql` | `a4b8709915fbad924212e3278b64d2f58d4d1e40c5ba1ff937cb7c50637d57d8` | skills / versions / history / discoveries / updates, blueprints, passports, capability requirements / gaps, Academy programs → scenarios → enrollments → attempts → evaluations → remediations → probation → certifications, activation requests, `run_execution_modes`, `employees_activation_gate` |

Schema properties:
- Schema version is 6.
- Every table is STRICT with bounded CHECKs.
- History tables are append-only and undeletable, and there are no hard deletes.
- Content columns are immutable and hash-pinned.
- An older runtime refuses a v6 database (`SCHEMA_FROM_FUTURE`).
- 0005 / 0006 were edited before release on this branch only, and re-pinned.

## 9. Proofs (automated)

| Mandatory proof | Test |
|---|---|
| Model output is only a candidate; policy decides; provenance is the run | storage `c3-mind` "a candidate is only a candidate…"; kernel "a candidate is only a proposal…" |
| Secrets never enter memory; duplicates never create independent truth | kernel / storage secret and duplicate tests |
| Canonical truth wins (retrieval, write time, lessons) | kernel "canonical truth wins…", "canonical claims bind structurally…"; storage "canonical truth wins immediately…"; review-fixes "canonical truth binds at write time too…" |
| Conflicts kept and held; resolution wakes held work | storage "two memories disagreeing…"; review-fixes "work held on a memory conflict wakes…"; runtime "an unresolved memory conflict holds IMPORTANT work…" |
| Staleness / corruption / correction | storage "stale memory…", "content-hash corruption…", "a Founder correction is additive…"; review-fixes "staleness is decay…" |
| Knowledge scope never leaks; cross-department use attributed | storage "restricted and Founder-only knowledge…", "cross-department knowledge…" |
| Every inference through governed assembly; no bypass | runtime "end to end…", "no bypass…"; storage "a model reservation must name this run's manifest…" |
| Hard budget; no full-history dump; deterministic across restart | kernel budget tests; storage "full history is never loaded…", "the budget is hard…", "selection is deterministic…" |
| Manifest content-free | storage "the manifest records exactly…" |
| Durable L6 only; long loops | review-fixes "recent results come from durable step records only…" |
| D3 / D4 never escape; D4 not retained; D3 not shared | storage "D3 / D4 context never escapes…"; review-fixes "D4 context is never retained…" |
| Skill supply chain, pinning, licence, paid dependency, holds | storage skill tests; review-fixes licence review; kernel inspection / eligibility |
| Skill ≠ Tool ≠ Authority; directive conflicts | kernel + storage "Skill ≠ Tool…", "conflicting skill directives…" |
| Capability gap durable, not re-routed, woken; re-check at settle; cancel | storage "a capability gap is durable…"; runtime "a capability gap parks the work…"; review-fixes gap tests |
| Academy path; certification ≠ activation; critical dimension; holdouts; no self-certification | storage Academy tests; kernel Academy tests |
| Constrained attempts: refused external action is scored; crash resumes to one attempt | storage "an attempted external action…", "an Academy attempt interrupted mid-run…" |
| Probation FAIL / EXTEND / REJECT paths; cert pins; recert magnitude | review-fixes Academy tests |
| Concurrent certification / promotion: exactly one | `storage/test/multiprocess/c3-concurrency.test.ts` (six + four OS processes) |
| Crash after candidate commit decided once | `runtime/test/faults/c3-fault.test.ts` |
| Idle: zero provider calls, zero assemblies | runtime "idle…"; acceptance |
| Bare Founder reference refused in production | storage "…all refuse a bare Founder reference"; acceptance `production-c3-authority-closed` |

Proof markers checked by the verifier rule `c3-proofs-present`: `C3-PROOF: mind-kernel`,
`storage-mind`, `review-fixes`, `concurrent-certification`, `runtime-mind`,
`memory-crash-recovery`.

## 10. Mutation checks, verifier, acceptances, results

- **`npm run c3:mutation`: 30 mutations.** Each removes one gate from the compiled output and
  requires a proof to fail:
  - **Memory:** `memory-secret-stored`, `memory-contradicts-canonical`,
    `memory-model-sets-confidence`, `memory-other-employee-visible`, `corrupt-content-used`,
    `pending-candidates-not-recovered`, `conflict-resolution-no-wake`.
  - **Context:** `context-budget-soft`, `reservation-without-manifest`, `knowledge-scope-leak`,
    `processor-supplied-recent-results`, `canonical-binds-only-if-relevant`,
    `model-accepts-foreign-context`, `context-hold-not-rechecked`, `term-limit-before-filter`,
    `compaction-crosses-markets`.
  - **Skills:** `skill-license-unclear-eligible`, `skill-paid-dependency-silent`,
    `skill-executable-content-passes`, `unpinned-skill-loads`, `licence-review-skipped`.
  - **Capability:** `capability-gate-bypassed`, `capability-wait-not-rechecked`.
  - **Academy:** `critical-dimension-compensated`, `academy-authority-unconstrained`,
    `holdout-reused`, `evaluator-sets-run-facts`, `probation-fail-no-new-epoch`,
    `rubric-ignores-refused-actions`, `failed-attempt-hides-breach`.
- **C1 / C2 mutation checks still run.**
  - C1's supervisor-guard count is now 8, because C3 candidate recovery adds three fenced
    transactions.
  - C2's search strings follow the C3 edits of the same gates.
- **Verifier:** 49 rules; 8 are C3 rules (D-C3-14), and each has a negative self-test.
- **Acceptances:** `c1:acceptance`, `c2:acceptance` and `c3:acceptance` all run in CI on Windows and
  Ubuntu. `c3:acceptance` has 9 steps:
  1. production authority closed;
  2. seeding via the test seam;
  3. idle zero calls / assemblies;
  4. Academy path in constrained mode (FAIL → retrain → PASS);
  5. certification is necessary but not sufficient;
  6. activation through Founder approval re-checks evidence;
  7. governed memory proposal and recall;
  8. capability gap is durable with no re-routing;
  9. health and CLI are content-free.

Results (Node 24.21.0 / SQLite 3.53.4, Linux Cloud):

| Suite | Tests | Result |
|---|---|---|
| mind (C3 kernel) | 27 | pass |
| storage (C1 + C2 + C3, incl. multi-process) | 196 | pass |
| runtime (C1 + C2 + C3, incl. fault matrices) | 61 | pass |
| bootstrap-contract (C0) | 5 | pass |
| domain (C1) | 22 | pass |
| governance (C2 kernel) | 25 | pass |
| **Total** | **336** | **0 failed, 0 skipped** |

- **Mutation checks:** C1 **6/6**, C2 **19/19**, C3 **30/30** caught.
- **Verifier:** **49/49** (48 rules + workspace resolution), and the self-test proves each of the 48 rules can fail.
- **Acceptances:** C1, C2 and C3 all **PASS**.
- **`git diff --check`:** clean.
- **Fresh-clone proof:** `git clone -c core.longpaths=true` of the pushed branch, then `npm ci` and
  `npm run ci`. The result is recorded on the PR for the final head.
- **Exact-head CI (Windows + Ubuntu):** recorded on PR #4 for the final head.

## 11. Internal review findings and dispositions (D-C3-16)

Five focused reviews were run: memory / knowledge, Academy / Skills, context assembly, authority /
fail-closed, and storage / runtime invariants. Every in-scope BLOCKER / MAJOR finding was fixed with
a regression proof.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| W1 | BLOCKER | conflict-review waits never woken | FIXED — same-tx wake on resolution; proof + mutation `conflict-resolution-no-wake` |
| W2 | MAJOR | lost wake between gap commit and WAIT settle | FIXED — settle re-check; mutation `capability-wait-not-rechecked` |
| W3 | MAJOR | cancelled gap strands job, no audit | FIXED — audited, wakes to `CAPABILITY_GAP_CANCELLED` |
| R1 | MAJOR | candidate recovery one tx per batch, no hash check | FIXED — one tx per candidate, `POLICY_ERROR` / `INTEGRITY_FAILED` |
| C1 | MAJOR | all recent results required | FIXED — only the newest required |
| C2 | MAJOR | recent results processor-supplied | FIXED — durable `context_step_results`; mutation |
| C3 | MAJOR | recency-ordered pools; canonical binds only if relevant | FIXED — term-matched pools, structural binding; mutation |
| C4 | MAJOR | full scans per assembly | FIXED — `mind_terms` index, bounded pools |
| C5 | MAJOR | summary churn / false invalidation | FIXED — query-independent sources, per-source invalidation |
| C6 | MAJOR | compaction bypasses claim precedence | FIXED — claim-bearing memories never compacted |
| M1 | MAJOR | market lost at write | FIXED — `market_ref` on memory / lessons |
| M2 | MAJOR | STALE dead end | FIXED — re-observation / Founder revalidation |
| M3 | MAJOR | no canonical check at write; lessons not covered | FIXED |
| A1 | MAJOR | learning-path dead ends | FIXED — evidence epochs, review rounds, withdraw; mutation |
| A2 | MAJOR | cert may pin deprecated / not-rolled-out version | FIXED — `pinnable`, unfinished updates excluded |
| A4 | MAJOR | recert ignores magnitude | FIXED — blueprint compare, TARGETED / PARTIAL / FULL |
| A6 | MAJOR | copyleft never reviewable; CC-BY auto-cleared | FIXED — licence review step; mutation |
| A7 | MAJOR | rubric ignores refusals | FIXED — all refusals count; mutation |
| P1 | MAJOR (Product) | losing certification does not affect ACTIVE Employee | FOUNDER DECIDED — implemented, D-C3-18 |
| P2 | MAJOR (Product) | approver identity fixed to `founder:*` | FOUNDER DECIDED — kept Founder-only / fail-closed; C4 widens (D-C3-22) |

**Re-review of the fix commit.** A final adversarial re-review confirmed most dispositions. It found
three partial fixes (W1, W3, C3) and two regressions (from C5 / M1 and A7), reported as four MAJOR
findings, all fixed in this task:

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| N3 | MAJOR | lost wake: conflict resolved / gap cancelled between the held assembly and the park; certification did not wake skill-conflict waits | FIXED — `txRecheckContextHold` at settle, cancelled-gap wake, member-retired wake, certification wake; mutation `context-hold-not-rechecked` |
| N4 | MAJOR | term-index LIMIT before status / scope filter (crowd-out) | FIXED — filter inside the query before the LIMIT; mutation `term-limit-before-filter` |
| N1 | MAJOR | compaction summarized one market's memories for another market | FIXED — only market-neutral memories are compacted; mutation `compaction-crosses-markets` |
| N2 | MAJOR | failed attempts voided, hiding refused actions | FIXED — refusals scored whatever became of the run; mutation `failed-attempt-hides-breach` |
| — | MINOR | pending promotion of a lesson contradicting new canonical truth left undecidable | FIXED — rejected `CONTRADICTS_CANONICAL` |
| — | MINOR | durable step results could store secret material | FIXED — withheld |
| — | MINOR | `wakeAllCapabilityGaps` bounded without ORDER BY | FIXED — deterministic, unbounded |
| — | MINOR | after EXTEND the same epoch's cases may satisfy the next review; SIMULATION allowed in RETRY | FOUNDER DECIDED — new evidence after EXTEND (D-C3-20); practice in RETRY allowed (D-C3-22) |

Other MINOR and NIT findings were fixed where cheap.

## 12. Security, privacy, dependencies and licences

- **Rule A (content-free telemetry):**
  - Audit rows, events, logs, manifests, health and CLI output carry IDs, versions, hashes, classes
    and codes only.
  - The verifier rule `mind-telemetry-content-free` enforces this.
- **Rules B and C:**
  - No QANDEEL App path and no App content ingestion.
  - No human review of private conversation content.
  - Memory is Company-internal Employee state only.
- **Secrets:**
  - Refused at candidate time; their content is not stored.
  - Test literals are assembled at runtime; the verifier scans for secret literals.
- **Runtime packages:** no network code, child process or native addon.
- **Windows:** pure JavaScript on signed Node 24. Arabic names and terms are covered by tests.
- **Dependencies:**
  - No third-party runtime or dev dependency was added.
  - The lockfile gains only the `@qandeel-company/mind` workspace link.
  - `npm audit`: 0 vulnerabilities.
  - No paid service, marketplace, vector database or embedding API is used.

## 13. Honest limits and deferred scope

- **Founder surface (C5).** Every C3 Founder-authority write fails closed in production
  (`FOUNDER_SURFACE_UNAVAILABLE`). This covers canonical truth, knowledge, Skill steps, evaluation,
  probation and activation. Tests use the test-only seam.
- **Review Pool (C4).** Lesson review and shared promotion wait for it, and independent evaluators do
  not exist yet.
- **Retrieval** is lexical and deterministic. There is no semantic retrieval, and a better retriever
  can replace it later without changing identity or provenance.
- **Compaction** is extractive, not model-written.
- **Skill sandboxing / benchmarking** records Founder evidence; C3 has no execution sandbox.
- **Product Owner questions** asked in D-C3-17 are all decided by the Founder (D-C3-18 .. D-C3-22).
  The numeric values stay engineering defaults / tunable policy values, not frozen Product constants.

## 14. Remaining Founder-host validation gate

On the Founder's Windows host, at the exact candidate SHA:
1. Run a fresh clone with `core.longpaths=true`, then `npm ci` and `npm run ci`. This covers the
   verifier, the C1 / C2 / C3 mutation checks and all tests, including multi-process.
2. Run `npm run c1:acceptance`, `npm run c2:acceptance` and `npm run c3:acceptance`.
3. Confirm Smart App Control raises no block: no native binaries, and signed Node 24 only.
4. Confirm that Arabic paths and names round-trip, and that a v5 / v6 database opens after a restart.
5. Re-read the sqlite.org pages on STRICT tables, triggers and deferrable foreign keys, which the
   Cloud cannot reach.
6. Complete the final independent review of this PR at its final head (the Founder decisions of
   D-C3-17 are recorded and implemented in D-C3-18 .. D-C3-22).

## 15. Skills used

None. The installed Skills were inspected and none applied to this repository's governed work, so
none had an effect. The reviews were performed by focused subagents (§11).
