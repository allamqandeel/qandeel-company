# C6 — Company Improvement Engine — Implementation Report

**Status:** IMPLEMENTATION CANDIDATE — NOT CLOSED. C6 closes only after Technical Lead exact-head review,
green GitHub CI on the exact PR head, merge, post-merge proof and closure sync. Sections 1–4 are the
pre-code design gate (written before any schema); the implementation record follows.

## 1. Start gate (repository truth, 2026-09-30)

| Check | Result |
|---|---|
| Repository / default branch | `allamqandeel/qandeel-company`, `main` (via `gh api`) |
| `origin/main` | `7c45f2ac105a9b47dd660b01c54eab556521255c` = the expected baseline (fetched with GitHub Desktop's signed Git; system Git's HTTPS is blocked by Smart App Control, L0) |
| PR #10 (C5) | merged 2026-09-29T21:05:34Z from exact head `5c4147f6`; exact-head run #81 SUCCESS (full matrix) |
| Post-merge run #82 | SUCCESS on `7c45f2a` — **fast-integrity path** (classify, integrity Windows + Ubuntu, quality-gate); the full matrix was skipped because the merged tree is the tree #81 proved |
| Working tree | clean; branch `c6/company-improvement-engine` created from exact `origin/main` |
| Engines | Node `v24.19.0`, npm `11.17.0` (`>=24.12 <25`, `>=11.6 <12`) |
| Released migrations | `0001`–`0009`, pins unchanged |
| Lifecycle drift | the implementation map and the C5 report still said C5 "NOT CLOSED"; no `docs/C5_CLOSURE_RECORD.md` existed, and the verifier (`c5-not-claimed-closed`) refused any C6 start without one |

**C5 lifecycle sync (inside this branch, not a separate task):** `docs/C5_CLOSURE_RECORD.md` records the
GitHub truth above; the implementation map marks C5 CLOSED / MERGED / CANONICAL and C6 as this candidate;
the C5 report gains a dated lifecycle note above its unchanged history. No C5 Product decision, code or
visual is touched.

## 2. Authority read (in full) and what binds C6

- **Stage 17** (closure, D17 register, handoff): no universal score; causal attribution across Employee
  Judgment / Model / Tool / Context Retrieval / Workflow / Provider / Requirement / External Dependency;
  bounded automatic quality protections only, never autonomous promotion / demotion / termination;
  governed learning; the failure → learning pipeline (Real Failure → Cause Analysis → Valid Failure Case →
  Regression Candidate → Review / Calibration → Regression or Gold Case) with hidden holdouts; exception-first
  daily / weekly / monthly reporting plus on-demand inspection; QANDEEL-owned, provider-independent Eval
  Registry; minimum-sample / uncertainty rules; Review Pool calibration and drift; cost per qualified
  outcome; activity counts are observability only.
- **Stage 15** (closure, D15 register, handoff): `Backup != Recovery Proof`; criticality classes
  (Critical / Important / Rebuildable) with per-class RPO / RTO; an encrypted copy outside the laptop
  failure domain; application-consistent capture; manifests and checksums; isolated restore drills;
  generational retention; portable recovery material that does not make the original device the sole trust
  anchor; clean-device restore with secret re-key; Preflight → Backup → Migrate → Verify → Activate with
  `UPDATE_HOLD` and restore from a compatible snapshot rather than unsafe downgrade; uncertain external
  side effects reconciled before repetition.
- **Master plan Stage 17 / Gate E17:** "System can distinguish productive learning from repeated activity."
- **Canonical baseline §5 (Rules A / B / C)**, BOUNDARIES (Company ≠ App), C1 runtime invariants (CLAUDE.md).

No contradiction between the task brief and the canonical authority was found. The Stage 16 source remains
missing and is not reconstructed.

## 3. Mechanism census — what C6 extends (never duplicates)

| Existing mechanism (C1–C5) | Fact that shapes C6 | C6 use |
|---|---|---|
| Work Item lifecycle (`COMPLETED → REVIEWED → OUTCOME_VERIFIED → CLOSED`, `work_items.outcome`) | `REVIEWED` is reached only through the Review Pool (`applyOutcome`); **nothing reaches `OUTCOME_VERIFIED` and no table holds verification evidence** | A governed outcome-verification act records the evidence and performs the existing transition; completion alone never counts |
| Review Pool (`review_requests`, `review_decisions` incl. `UNCERTAIN` / `INSUFFICIENT_EVIDENCE`, `review_calibrations`, `quality_holds`, `oversight_findings`) | Calibration covers SHADOW decisions only; no false-approval / false-rejection / drift measure | Reviewer meta-evaluation is a read model over the same rows plus outcome verification; systemic findings map onto `oversight_findings` where the target kind exists |
| Learning lifecycle (`lessons` OBSERVATION → LESSON_CANDIDATE → UNDER_REVIEW → VALIDATED / REJECTED, `lesson_promotions`, `knowledge_items`, `canonical_truth`) | Employee observations arrive through the existing Memory Write Policy (`memory_candidates` kind OBSERVATION) | Reflection = an employee-originated observation; C6 classifies lessons (mistake / successful pattern / near miss) in a companion table and gates their validation and promotion; no second learning store |
| Academy (`academy_scenarios` PRACTICE / ASSESSMENT / HOLDOUT, exposures, remediations DIAGNOSED → RETRAINING → RETEST_READY → RETESTED, certifications, re-certification) | Holdouts reach context only inside their own open attempt | Interventions link to remediations; regression / Gold cases bind to Academy scenarios; retraining material never lists hidden cases |
| Goals / Goal → Work links (C5) | stable ids | Goal progress in reports; inspection by Goal |
| `usage_records` (attempt_kind PRIMARY / RETRY / FALLBACK / ESCALATION, outcome OK / FAILED_CHARGED) | the cost ledger | Cost per qualified outcome is derived from it; no second ledger |
| Founder Attention (C5, `collectSignals`) | dedup / cooldown over canonical sources | Material C6 exceptions (a validated systemic finding awaiting the Founder, a stale off-device backup, a failed drill, an update hold) join the existing collector as `DECISION_REQUEST` sources; no second notification bus |
| C5 change-signalling contract (`signalling`) | reads silent, failures silent, one announcement per mutation | The C6 store joins the Founder capability with an explicit classification |
| Backup (`createBackup`, `verifyBackup`, `restoreToIsolatedWorkspace`, `backup_records` append-only) | same-device only; database only on restore; no retention; no encryption | Extended with an encrypted portable package (database + manifest + artifact objects), destinations, generations, clean-environment restore and restore drills |
| Migrations (`migrate`, pins, `SCHEMA_FROM_FUTURE`) | applied at open; no pre-update snapshot or hold | Preflight → Backup → Rehearse → Migrate → Verify → Activate, `UPDATE_HOLD` refused at open |
| Runtime recovery (`SAFE_TO_RESUME` / `SAFE_TO_RETRY` / `RECONCILIATION_REQUIRED`, tool idempotency keys) | uncertain tool effects held for Founder reconciliation | Reused unchanged after a restore; proven not to repeat an uncertain effect |

## 4. C6 architecture plan (before schema)

- **Kernel (pure, `@qandeel-company/mind`, `src/improvement/`):** evidence model; the deterministic
  reference evaluator; attribution proposal; Performance Profile (per dimension, sample, confidence, trend,
  capability vs regression, readiness signal — no aggregate); learning-effect assessment; systemic detection;
  near-miss / smart-success detection; cost per qualified outcome; report composition with typed claims
  (FACT / ASSESSMENT / TREND / RECOMMENDATION) that refuse an unevidenced judgement; evaluator
  meta-evaluation over reference cases (known-good, known-bad, ambiguous, non-employee cause, valid creative
  path).
- **Storage (`@qandeel-company/storage`, migration `0010_c6_improvement_engine.sql`):** Eval Registry
  (versioned definitions, calibration runs), outcome verifications, evaluation results, causal attributions
  (+ history), learning signals (companion to `lessons`), learning interventions (+ history), systemic
  findings (+ history), regression cases (+ history), report snapshots, and resilience records (backup
  generations, portable packages, restore drills, maintenance records). Every table: STRICT, no delete,
  append-only history, forward-only updates, content-free audit.
- **Resilience (storage):** recovery objectives by class; encrypted portable packages (scrypt → AES-256-GCM,
  `node:crypto` only, passphrase supplied by the operator and never stored); a destination abstraction with
  a directory destination and failure-domain classification; generational retention; clean-environment
  restore with credential re-key report and session revocation; update maintenance with `UPDATE_HOLD`.
- **Runtime / surface:** a `founder.improvement` capability classified under the C5 signalling contract;
  read-only API routes for reports and evidence inspection; CLI commands for portable backup, restore,
  drills, retention and safe upgrade. No Tree of Light change.
- **Authority:** Founder decides activations, promotions and Eval Registry acts (the existing chokepoint);
  operational judgment (outcome verification, attribution validation, lesson validation, ordinary retraining)
  is delegated by evidence, qualification, review policy and risk — the Review Pool of a plan that says
  `REVIEW_POOL` decides it, the Founder remains the exception / override authority (C6-R1, D-C6-10); the system
  evaluator writes only evaluation evidence derived from canonical rows; no C6 output or judgment changes
  authority, role, certification, budget, approval, route or policy; recommendations are text codes, not acts.
- **Privacy:** C6 reads Company-side work lineage only; no App data, no private content; audit carries ids,
  states and codes (Rule A).

## 5. What C6 makes QANDEEL capable of (plain language)

- **Know whether work succeeded.** "Done" is not "good": a Work Item counts as a qualified outcome only after an
  independent reviewer passed it AND its achievement was verified with evidence — by the qualified independent
  reviewers themselves where the work's Review Plan delegates that judgment (each cites its own judgment; a
  disagreement is never averaged and goes to the Founder), otherwise by the Founder.
- **Know why.** When something goes wrong the evaluator reads the work's real record (reviews, runs, tools,
  context, costs) and proposes a cause — the Employee's judgement, or a tool, model, provider, context,
  workflow, requirement or external dependency. An independent qualified reviewer from the Review Pool (never
  the Employee concerned) confirms or rejects it; any doubt goes to the Founder. An Employee is never blamed for
  a broken tool.
- **Without making the Founder the bottleneck — and without loosening money or authority.** Ordinary judging,
  verifying and learning run without the Founder; a judgment never grants a tool, a budget, an approval, a
  higher risk ceiling or a route, R3 still needs the Founder's approval before it acts, and R4 stays the
  Founder's alone. The Founder still decides what is exceptional: disagreements, uncertainty, R4, policy.
- **Judge people fairly.** Each Employee has a profile of eight dimensions with how much evidence stands behind
  each one. One good task is "not enough evidence yet", never "excellent". There is no single score, no rank,
  no leaderboard; "ready for greater responsibility" is a prompt for the Founder's review, never a promotion.
- **Learn — and prove it.** An Employee's own reflection is only a hypothesis until an independent cause
  analysis supports it. A validated lesson leads to targeted retraining, but "training finished" is not
  "improved": only later comparable work that no longer repeats the mistake proves improvement. Smart
  successes become pattern candidates and are shared only after verified reuse. When the same failure repeats
  across different people, QANDEEL questions the workflow itself (a systemic finding for the Founder). When an
  Employee is the one who spots a problem in the system (a broken tool, a flawed workflow) and independent cause
  analysis confirms it, the finding records that Employee as its author and credits it to their growth once the
  Founder validates it; findings the system detects on its own credit nobody. Credit never grants authority.
- **Report like an executive team.** Daily, weekly and monthly reports state facts, assessments, trends and
  recommendations separately; every judgement cites its evidence and its uncertainty. Only material exceptions
  interrupt the Founder.
- **Survive the loss of the laptop.** An encrypted, portable package of the whole company (database, artifacts)
  can be written outside the laptop, verified, kept in generations, restored onto a clean machine, and the
  restored company resumes without repeating an uncertain external action. Schema updates are rehearsed on a
  snapshot first; a failure rolls back and holds the company safely until the operator decides.

## 6. Schema (migration `0010_c6_improvement_engine.sql`, pinned `a8696420…`)

| Table | Source of truth / writer | Readers | Lifecycle / idempotency | Retention / privacy |
|---|---|---|---|---|
| `eval_definitions` (+`_history`) | Founder (registry acts) | evaluator, Founder surface | DRAFT → ACTIVE (only with a passed own-spec calibration run, trigger) → SUPERSEDED / RETIRED; spec immutable per version; one ACTIVE per code | never deleted; codes and spec JSON (no content) |
| `eval_calibration_runs` | Founder-triggered, deterministic | Founder, R2 | append-only; bound to the spec hash | never deleted; case ids and verdict codes |
| `outcome_verifications` | Founder, or the review keys of a satisfied output review under a `REVIEW_POOL` plan (`verifier_kind`, `review_request_id`) | evaluator, reports, attention | append-only; one decisive verdict per Work Item; needs a reviewed Work Item (trigger); a pool verdict needs every passing key's matching judgment and a pool-delegated, non-R4 plan (trigger); no `EXTERNAL_OUTCOME` (CHECK) | never deleted; evidence refs only |
| `review_outcome_judgments` | a counting Employee review decision of an output (its C6 companion) | pool verification | append-only; only on an independent counting output decision (trigger) | never deleted; verdict + evidence classes |
| `judgment_assignments` | system (drawn from the plan's Review Pool); the judge's fenced review decision | attention, reads | ASSIGNED → DECIDED / ESCALATED / WITHDRAWN once; one open per subject; qualified, independent, non-R4, pool-delegated (trigger) | never deleted; ids, codes |
| `evaluation_results` | system evaluator (derived from canonical rows) | profiles, reports, inspection | one live per (Work Item, definition); re-evaluation supersedes; unchanged evidence is a no-op (evidence hash); qualified needs an ACHIEVED verification and an ACTIVE definition (triggers) | never deleted; counts, codes, refs |
| `causal_attributions` (+`_history`) | evaluator proposal / Founder or assigned pool judge decision | profiles, learning, systemic detection | one live per Work Item; PROPOSED → VALIDATED / REJECTED / SUPERSEDED; the subject Employee never decides (CHECK); an Employee decider is exactly its DECIDED judge (trigger) | never deleted; cause codes |
| `learning_signals` | evaluator / classification act | learning gates, reports, systemic provenance | append-only; one per observation; classifies C3 observations only (trigger); a `SYSTEMIC_PROBLEM` signal is never validated as a lesson (trigger) | never deleted; codes |
| `learning_interventions` (+`_history`) | Founder plan / completion, or the system for a lesson validated on the independent path (completion only on objective evidence); system assessment | profiles, reports | PLANNED → TRAINING_COMPLETED → EFFECT_ASSESSED; decisive effect final; retraining bound (trigger); only on VALIDATED lessons (trigger) | never deleted; refs, codes |
| `systemic_findings` (+`_history`) | system detection (upsert by dedup key) or a classified `SYSTEMIC_PROBLEM` observation on a validated system cause; Founder decision | attention, reports, System Contribution | CANDIDATE → VALIDATED / REJECTED → ADDRESSED; evidence only grows while a candidate; provenance (`origin`, `source_signal_id`, `contributor_employee_id`) fixed at creation — a contributor is exactly the author of a reflected source observation, or nobody (CHECKs + trigger) | never deleted; refs, codes, ids |
| `failure_cases` (+`_history`) | Founder | Academy material, R2 | REAL_FAILURE → … → REGRESSION_CASE / GOLD_CASE / REJECTED; hidden ⇔ HOLDOUT scenario (trigger) | never deleted; ids |
| `report_snapshots` | system reporter | Founder surface, CLI | append-only; idempotent per (cadence, period end, claims hash) | never deleted; claim codes / refs / counts |
| `backup_retirements` | retention | discovery | append-only; never retires the last live generation (trigger) | the backup files are removed; the record stays |
| `portable_backups` | resilience (after read-back verification) | status, retention | VERIFIED → RETIRED; re-verification only moves `verified_at` forward; one VERIFIED kept (trigger) | destination path stored only as a hash |
| `recovery_drills` | resilience | status, attention | append-only | codes, durations |
| `maintenance_records` | maintenance (post-hoc) | status | append-only | versions, checksum, code |

New triggers guard existing C3 tables: `lessons_c6_validation_gate` (classified learning is validated only
on independent evidence), `lesson_promotions_c6_pattern_gate` (a pattern is shared only after two verified
reuses) and `lessons_judged_by_assignment` (an Employee decider is the lesson's assigned judge, never its maker).
C6-R1 adds one column to the 0008 `review_plans` table, `operational_judgment` (`FOUNDER` default /
`REVIEW_POOL`), frozen per plan version and refused beside a FOUNDER key (triggers). Everything else from
0001–0009 is unchanged.

## 7. Implementation record

- **Kernel** (`packages/mind/src/`): `evaluation.ts` (evidence model, reference evaluator, attribution, meta-
  evaluation, standard definition and reference cases), `performance.ts` (profile, cost per qualified outcome,
  reviewer meta-evaluation), `improvement.ts` (learning gates, near miss / smart success, pattern expansion,
  effect assessment, retraining bound, systemic detection, failure-case lifecycle, retraining material),
  `reporting.ts` (claims, `assertClaim`, daily / weekly / monthly composition).
- **Storage** (`packages/storage/src/`): `improvement-core.ts` (evidence gathering), `improvement.ts`
  (`ImprovementStore`), `resilience.ts`, `maintenance.ts`, `update-hold.ts`; gates wired into
  `memory.ts` (`validateLesson`, `decidePromotion`); `attention.ts` collects material C6 exceptions;
  `store.ts` refuses a held workspace (except read-only inspection); `backup.ts` discovery excludes retired
  generations; the test-only seam gains `createWorkspaceAtVersionForTest`.
- **Runtime / surface**: `founder.improvement` under the signalling contract; `portableBackup`, `restoreDrill`,
  `pruneBackups`, `resilience`; CLI commands (`improvement`, `report`, `portable-backup`, `restore-portable`,
  `restore-drill`, `prune-backups`, `safe-upgrade`, `clear-update-hold`, `rollback-update`); Founder API
  routes (`/api/improvement/{reports,inspect,profiles/:id,resilience}`); command intents `SHOW_REPORT`,
  `SHOW_PERFORMANCE` (English and Arabic). The Tree of Light is unchanged (two intent labels added).
- **Defects found and fixed before the PR (root cause proven first):**
  1. *Acceptance, implementation defect in evidence mapping:* a tool failure recorded on the run as
     `TOOL_NOT_EXECUTED` (run 1 `FAILED_RETRYABLE`, run 2 retried the same idempotent intent to `SUCCEEDED`) was
     not in the tool-failure family, and every `FAILED_CHARGED` usage row was counted as a provider cause — so a
     tool failure was proposed as PROVIDER. Fix: the cause is read from the run's recorded failure
     classification; a billed failed call is cost overhead only. Guarded by a storage proof and the
     `c6-tool-failure-unmapped` mutation.
  2. *Verifier, naming defect:* the maintenance rollback was first named `rollbackUpdate`, colliding with the C3
     Skill act the CLI is forbidden to call; renamed `rollbackSchemaUpdate`.
  3. *Independent review (code-review skill, high), nine correctness fixes:* re-assessment could violate the
     intervention CHECK; the evaluation read bound dropped the newest rows; the off-device RPO used the
     verification time instead of the data's age; "latest" ties broke on random ids; a stale proposal stayed
     decidable; a failed clean restore left a half-built target; read-only inspection was refused under a hold;
     an unvalidated report period; POSIX volumes were all "same volume".
  4. *Review finding #9, fixed before the PR at the Product Owner's direction (it was first proposed as residual
     R-C6-01):* systemic findings carried no provenance, so System Contribution could never credit an Employee
     who discovered a problem in the system. Fix (D-C6-09): the existing C3 observation → C6 learning-signal path
     gains the fourth learning output `SYSTEMIC_PROBLEM`; a finding reported that way keeps its source signal and
     names a contributor only when the observation is the Employee's own reflection, only on a VALIDATED
     system cause, and the credit counts only once the Founder validates the finding. Guarded by kernel and
     storage proofs and the `c6-systemic-credit-misattributed` / `c6-systemic-credit-before-validation`
     mutations.
  5. *C6-R1 corrective amendment (exact-head review of PR #11, Product Owner brief, D-C6-10):* ordinary outcome
     verification, attribution validation, lesson validation and retraining were effectively Founder-only — an
     operational bottleneck. Root cause: C6 bound every judgment to the Founder chokepoint instead of to the C4
     review policy that already models who may judge. Fix, extending C4 only: the Review Plan's
     `operationalJudgment` (`FOUNDER` default / `REVIEW_POOL`; never beside a FOUNDER key; never R4); the review
     keys' own cited outcome judgments verify the outcome when they satisfy the review (disagreement →
     INCONCLUSIVE, never averaged); one independent qualified pool judge, drawn by the C4 eligibility SQL and
     funded from the plan's review budget, validates or rejects an attribution or a lesson through the same fenced
     review decision, escalating any uncertainty to the Founder; ordinary retraining on objective evidence. The
     stale C3 wording ("the independent review path does not exist") is corrected. Proven with the Founder
     surface disarmed and an unchanged authority / spend fingerprint (storage proof and acceptance), kernel proofs
     and eleven `c6r1-*` mutations. Found while building it (root cause first): the verifier confines lesson
     writes to the C3 modules, so the two lesson steps live in `mind-writes.ts`; a C4 mutation anchor
     (`...(executor ? [executor] : [])`) must stay unique in `review-core.js`, so the judge exclusions are
     written differently; a judge's subject must not wait forever for capacity, so the C4 refill and recovery
     sweep also draw waiting judges.
  No root-cause family recurred a second time.

## 8. Validation (see the PR description for the exact head and GitHub runs)

Focused during the build: kernel 37 tests, storage C6 18 tests (plus the full storage suite), runtime C6 3 tests
(plus the full runtime suite, C5 signalling proofs included), `c6:mutation` 29/29 caught, `c6:acceptance`
20/20 PASS, verifier 69/69 with every new rule self-tested, `eslint --max-warnings=0` clean.
C6-R1, focused: governance judgment kernel 5 tests (governance 65), storage C6-R1 proofs 5 tests (storage 24 files /
307 tests), runtime 104, command-center 9, `c6:mutation` 40/40 caught (11 new `c6r1-*`), every C1–C6 / R1
mutation anchor re-checked against the rebuilt output (179 anchors), `c6:acceptance` 21/21 PASS (the new
Founder-free step), verifier 69/69, lint clean. The full local
gate (`npm ci`, `npm run ci`, C1–C6 acceptances, the C5 browser smoke) runs once on the closure-candidate tree
before the PR; GitHub CI (Windows + Ubuntu) on the exact PR head is the confirmation.

## 9. G1 — Skills inspected and used

| Skill | Used | Where / effect |
|---|---|---|
| `code-review` (high) | yes | Independent correctness review of the full C6 diff before the PR: ten findings, all ten fixed with proofs (§7.3, §7.4) |
| `security-review` | attempted | Could not launch: it shells out through the Bash tool, which exits 2 on every command on this host (known Founder-host quirk); replaced by a manual security pass over the crypto / recovery path (AES-256-GCM with header AAD and per-package random IV, pinned scrypt parameters, entry allow-list, contained paths, passphrase never stored) and the verifier rule `c6-recovery-secret-never-stored` |
| `code-review` (high), C6-R1 | yes | Review of the C6-R1 working-tree diff: five findings — a lesson put up for review before its cause was judged escalated permanently to the Founder (fixed: a lesson judge is drawn only once its evidence exists; a judge who PASSes too early stands down; validated causes and qualified evaluations wake waiting lessons); the decision-time eligibility re-check lacked the open-envelope condition (fixed); three kept as documented: PERSONAL-delivery as training evidence (effect still needs later evidence), NEEDS_SPECIALIST escalates rather than reassigns, refill scans all domains (bounded) |
| `security-review`, C6-R1 | attempted | Failed again at launch (it runs `git status` through the unavailable Bash tool). Replaced by a manual authority / spend boundary pass: grants and approval decisions are `founder:*` in the datastore; a judge's only budget is a Work Item allocation within the plan's review budget from its own envelope; no route, deployment, tool, seat, delegation or certification write exists on any judgment path; R4 refused in kernel, trigger and C4 review; identities come from the run fence and forged judges / verifiers are refused by triggers — each backed by a proof or a `c6r1-*` mutation |
| `dataviz`, `artifact-diagramming`, `impeccable`, `frontend-design`, `animate`, `emil-design-eng`, `ui-ux-pro-max`, `sibawayh:*` | no | C6 changes no visual surface (Tree of Light frozen; two intent labels only), draws no chart and writes no Arabic UI copy |
| `claude-api` | no | C6 makes no model call (the evaluator is deterministic; `MODEL_GRADER` is an unexecuted seam) |
| `workflow-authoring`, `simplify`, `docs`, `docx`, `pptx`, `xlsx`, `pdf`, React Native / Expo / media skills | no | Not relevant to a backend evaluation / recovery engine |

## 10. Residuals and deferred items (no hidden claims)

- **R-C6-01:** closed before the PR (§7.4) — systemic findings carry traceable provenance and credit their
  Employee author.
- **R-C6-02 (MINOR, Product):** reports and profiles are reachable through the API, the command palette's read
  intents and the CLI; a dedicated report view inside the Tree of Light is not built (the surface is frozen).
- **R-C6-03 (MINOR):** portable packages are built in memory (bounded at 1.5 GiB, refused above); streaming
  encryption for larger companies is future work.
- **R-C6-04:** closed by C6-R1 (§7.5, D-C6-10) — ordinary outcome verification, attribution and learning
  validation are delegated to the Review Pool by the plan; the Founder remains the exception authority.
- **R-C6-06 (MINOR, C6-R1 scope):** a systemic finding's diagnosis is still decided by the Founder (the brief
  permits Review Pool diagnosis; the ordinary loop does not need it, and remediation keeps its own authority);
  no deterministic outcome verifier is added (no machine-verifiable outcome criteria source exists before C7);
  judge capacity is bounded by the reviewer's open review assignments only.
- **R-C6-05:** minimum-sample, trend, retraining-bound and RPO / RTO values are conservative Strong-v1 defaults
  to be calibrated in the Pilot, not statistically derived thresholds.
- **Carried from C5 (unchanged):** the CSP-blocked Department tint on context-sheet avatars; the 4 fps
  walkthrough capture (proof-only).
- **Not proven here (deferred):** a physical laptop loss and restore on a real replacement device, week-long
  continuity, a real cloud-storage destination, destructive disaster rehearsal (L1 / Controlled Pilots); App
  telemetry and external campaign / traffic outcomes (C7 — stated `unavailable`, never invented).

## 11. Handoff

- **R2** can independently inspect: calibration runs and reference cases, every evaluation's evidence JSON and
  hash, attribution history, learning-signal gates (code + triggers), intervention effects with their evidence
  refs, systemic findings, report claims with evidence and uncertainty, recovery drills and maintenance
  records — and re-run `c6:acceptance` / `c6:mutation`.
- **C7** plugs governed external outcomes into the seam: the `EXTERNAL_OUTCOME` evidence class (refused today),
  `EXTERNAL_OUTCOMES_AVAILABLE` (false until a C7 closure, verifier-guarded), the `external` failure count and
  the reports' `EXTERNAL_OUTCOMES_UNAVAILABLE` claim. APP-OPS stays content-free (Rules A / B / C).