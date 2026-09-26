# C1 — Company Foundation & Durable Runtime — Implementation Report

**Nature:** implementation report for the C1 Cloud mega-task. **This is not a closure record.
C1 is NOT CLOSED.** C1 closes only after independent review, Founder-host local acceptance,
exact-head CI and merge approval. **C2 is not started.**

**Status:** `C1 — CLOUD IMPLEMENTATION CANDIDATE — READY FOR INDEPENDENT + FOUNDER-HOST REVIEW`
(see §21–§22 for the evidence behind it).

## 1. Baseline SHA

`origin/main` = `deef86c84d8dd68623497160f9b7660f8b89b722` (`docs: import Company authority for C1
cloud execution (#1)`), exactly the expected baseline.

The truth gate ran before any change:
- `main` had not advanced;
- the working tree was clean;
- the repository is private (per the C0 closure record and the task).

The Cloud session had no Node 24, so Node **v24.21.0** was installed from `nodejs.org`, with its
`SHASUMS256` verified. That install is a development-environment action only.

## 2. Branch / PR

- **Branch:** `claude/dreamy-wozniak-nq3hr8`. The Cloud platform mandated it; the preferred
  `feat/c1-company-foundation-durable-runtime` could not be used (D-C1-16).
- **PR:** Draft, "feat: implement C1 durable company runtime foundation". The link is in the final
  response. **NOT APPROVED FOR MERGE.**

## 3. Authority read

Read in full before design:
- `README.md`, `CLAUDE.md`;
- `COMPANY_CANONICAL_BASELINE.md`, `IMPLEMENTATION_AUTHORITY_RULES.md`;
- the authority index (`company-architecture/README.md`);
- `IMPLEMENTATION_MAP.md`, `BOUNDARIES.md`, `DECISION_LOG.md`;
- the L0 decision, the C0 closure and the PRE-C1 closure;
- the Founding Constitution (§1–§28);
- Stages 0, 1, 2, 3, 8, 9, 11 and 12;
- Stage 13, Stage 14 and Stage 15 (closure, decision register and handoff for each);
- Stage 17 (closure, register and handoff);
- Master Plan §8.

Stage 16 is missing and was not reconstructed; it is not needed for C1.

**No `AUTHORITY CONFLICT — PRODUCT OWNER REVIEW REQUIRED` was found.** Where the authority left an
engineering choice open, the choice is recorded:
- dependency satisfaction point — D-C1-09;
- cancel-vs-complete race rule — D-C1-08;
- fail-closed approval — D-C1-07.

## 4. Skills used

G1 Skills gate. The installed Skills were inspected before implementation; the relevant ones are
code/security review. No TypeScript-architecture, SQLite, test-design or failure-testing Skill is
installed. UI, design, document, slides and data-visualization Skills were not invoked.

| Skill | Concrete effect |
|---|---|
| `security-review` | The first invocation failed: this clone had no `origin/HEAD`. A local `git remote set-head origin main` fixed that, and the Skill then ran on the full branch diff. Its sub-agent traced every untrusted input (Work Item fields, artifact content and labels, manifests, checkpoints, workspace files) to SQL, paths, processes and logs, and reported **no high-confidence vulnerability** (§22). It complemented review lens C. |
| `code-review` | Not invoked as a Skill. The task (§67) requires three separate independent read-only lenses with BLOCKER/MAJOR/MINOR/NIT severity. They ran as independent sub-agents against the exact head, each with a scratch copy for probes and mutation tests. |

## 5. Official research refresh

- **Node.** `nodejs.org/download/release/latest-v24.x/docs/api/sqlite.md` (v24.21.0) was read on
  2026-09-26. Confirmed:
  - status is Release Candidate (since v24.15.0);
  - `DatabaseSync` is synchronous;
  - foreign keys on by default; `allowExtension` false by default;
  - `defensive`, since v24.12.0 and default since v24.14.0;
  - `timeout` (v24.0.0);
  - `backup()` wraps `sqlite3_backup_*`, and other-connection writes restart a paged backup.
- **SQLite.** `sqlite.org` was **blocked by the Cloud egress policy**. The fallbacks were:
  - SQLite's own API text in `sqlite3.h` 3.53.4, as vendored in Node v24.21.0;
  - empirical probes on the bundled SQLite 3.53.4: WAL reader/writer isolation, a bounded busy
    failure, the defensive probe, extension refusal, backup plus a rollback-journal snapshot.

  The WAL/transaction/pragma facts were not re-fetched; they are recorded from prior knowledge and
  match the task. **Founder-host follow-up:** re-read the four pages (D-C1-05).
- **Consequences:**
  - the Node floor rises to 24.12.0 (D-C1-02);
  - `synchronous=FULL`; `wal_autocheckpoint` untouched (D-C1-04);
  - single-step backup plus a self-contained snapshot (D-C1-12).

## 6. Architecture / package shape

`domain` (pure) → `storage` (the only `node:sqlite` user) → `runtime` (supervisor, CLI);
`bootstrap-contract` is unchanged. No placeholder package exists, and `ALLOWED_PACKAGES` was extended
(D-C1-01).

## 7. Node / SQLite decisions

Each connection has, and verifies at open:
- a file-backed database;
- WAL, read back;
- `synchronous=FULL`;
- foreign keys;
- defensive mode, proven by a probe;
- no extension loading;
- no double-quoted string literals;
- `trusted_schema=OFF`;
- a bounded busy timeout (5 s by default).

Write transactions are `BEGIN IMMEDIATE`, and async callbacks are refused. No third-party SQLite
library is used. D-C1-02 to D-C1-04 record the reasoning.

## 8. Schema / migrations

- **Schema version 2.** The files are `0001_work_foundation.sql` (work items, dependencies,
  transitions, idempotency, events, audit, runtime instances, leases) and
  `0002_queue_runs_artifacts.sql` (queue, runs, checkpoints, artifacts, backup records).
- **Tables:** 14 plus `schema_migrations`, all STRICT, with foreign keys `ON DELETE RESTRICT`,
  `CHECK`s, partial unique indexes and history-protecting triggers (see
  `docs/c1/C1_SCHEMA_AND_STATE.md`).
- **Migrations:** each is pinned by SHA-256 and runs in its own transaction.
- **Compatibility policy:** forward only. Unknown or future schemas are refused
  (`SCHEMA_FROM_FUTURE`), and nothing is ever downgraded automatically. A failed migration rolls back
  to the prior coherent version.

## 9. Work Item semantics

- **All 15 canonical states are present**, and performed, completed, reviewed, outcome verified and
  closed stay distinct. Outcome is a separate column (`NOT_ASSESSED`, `ACHIEVED`, `NOT_ACHIEVED`).
- **Stage 8 fields are durable:** objective, owner, contributors, priority, due, risk, completion
  criteria, required evidence, review, approval, version, timestamps, cancellation and supersession,
  and the dedupe key.
- **History:** every transition is recorded, and the version rises by exactly one per update.
- **No hard delete** exists anywhere.
- **Fail-closed approval** applies to approval-required and R3/R4 work.

## 10. Runs / checkpoints

- **Runs** have:
  - a stable ID, `run_seq` and `attempt`;
  - the processor kind and side-effect class;
  - state and start/end times;
  - the checkpoint sequence and `retry_of_run_id`;
  - the correlation ID;
  - the failure code and category;
  - the recovery disposition (`SAFE_TO_RESUME`, `SAFE_TO_RETRY`, `RECONCILIATION_REQUIRED`);
  - fencing metadata.
- **Checkpoints** are monotonic, SHA-256-checked and append-only. Resume uses the latest valid
  checkpoint.

## 11. Queue / claim / leases / fencing

- **Durable queue** with deterministic ordering (persisted priority, due time, creation, ID).
- **Atomic claim** by one `BEGIN IMMEDIATE` conditional update.
- **Per-job fencing token** checked on every worker write.
- **Supervisor lease** with its own token, re-checked inside every claim.
- **Proofs:**
  - the in-process A/B fencing sequence;
  - six **processes** racing for one job, with exactly one winner;
  - a **cross-process** stale worker whose checkpoint and completion are rejected while B stays
    authoritative.

## 12. Event-driven wake-up

- **Wake sources:** an in-process coalesced signal after each commit; a cross-process wake file
  watched with `fs.watch`; one next-due timer; slot release. There is no polling loop.
- **Idle proof:** zero SQL statements, zero pumps and zero `fetch` calls over an idle window, with no
  scheduler timer armed.

## 13. Idempotency

- **Mechanism:** `(scope, key)` → canonical-JSON SHA-256 fingerprint → result reference, in the same
  transaction as the creation.
- **Outcomes:** the same input replays, and a different input fails with `IDEMPOTENCY_CONFLICT`,
  which is audited.
- **Crash proof:** the same key submitted again after a crash yields one canonical Work Item.
- **Deterministic dedupe key:** one live Work Item per key.
- No claim of exactly-once external effects is made.

## 14. Recovery

The startup recovery pass completes before READY and is bounded and idempotent (see
`docs/c1/C1_RUNTIME_RECOVERY_MODEL.md` §8). It handles:
- claims left by earlier supervisors;
- orphan runs;
- dangling cancellation intent;
- the artifact boundary;
- a summary of due, held and dead-lettered work.

A second crash during recovery is proven safe.

## 15. Artifacts

- **Content-addressed objects** live outside SQLite and are hashed with SHA-256.
- **Write protocol:** a task-owned temp file with fsync, then a STAGED row, then an atomic rename,
  then READY after verification.
- **Every crash window is tested:** before the rename, after the rename, orphan objects, missing
  objects, duplicate content and corrupt content.
- **Path safety:** only a UUID or hex hash ever builds a path.

## 16. Backup / restore primitive

- **Backup:** the Online Backup API on a dedicated connection, a self-contained snapshot, the full
  `integrity_check`, and a manifest with checksums, counts and the artifact manifest.
- **Isolated verification:** read-only open, integrity check, migration pins, critical read proof.
- **Isolated restore:** a dry start in a new, empty workspace. The live database is never replaced.
- **Backup under activity:** proven in-process and against a separate writer **process**.
- **Deferred to C6/L1:** encrypted off-device copies, retention, immutable copies, device-loss
  promotion and rollback orchestration.

## 17. Health / readiness

- **Liveness.**
- **Readiness:** workspace, database, WAL, migrations, supervisor lease, recovery complete, artifact
  store.
- **Snapshot:** runtime, database, migrations, supervisor, queue, work items, recovery, artifacts,
  backup and disk, with `HEALTHY`, `DEGRADED`, `ATTENTION` or `CRITICAL` plus reason codes.
- **Read-only cross-process inspection:** `inspectWorkspace`.
- **CLI:** `init`, `start`, `health`, `submit`, `cancel`, `backup`, `verify-backup`,
  `restore-check`, `verify-artifacts`.

## 18. Security / privacy

- **Attack surface added:**
  - a local library API;
  - a local CLI run under the signed Node runtime;
  - files under a caller-chosen workspace (`state/`, `artifacts/{objects,tmp,quarantine}/`,
    `backups/`, `runtime/wake.signal`).
- **Not added:** no network listener, HTTP, IPC server or socket; no provider SDK; no secrets; no
  external tool execution; no App data or App repository access; no generic ingestion endpoint.
- **SQL:** constant SQL text with bound parameters only, and no exported SQL surface (verified at
  run time).
- **Paths:** relative, UNC, device and symlinked paths are rejected, and only an ID or hash builds a
  file path.
- **Stale workers:** every worker write is fenced, and every rejection is audited.
- **Content-free telemetry (Rule A):**
  - logs carry short scalars only; objects are dropped, strings capped and errors reduced to codes;
  - events and audit rows carry IDs, states and codes only;
  - JSON keys that name credentials are refused.

## 19. Dependency audit

- **Runtime dependencies of the C1 packages:** only the `@qandeel-company/*` workspace packages.
  There are no third-party runtime dependencies.
- **Development tree:** unchanged (98 external packages plus 4 workspace links); no install scripts;
  no `.node`, `.wasm`, `.dll`, `.so`, `.dylib` or `.exe` files in `node_modules`.
- **`npm audit`:** 0 vulnerabilities.
- **Verifier:** the `runtime-dependencies-allowlisted` rule prevents regressions.

## 20. Unit / integration / fault test results

| Package | Files | Tests | Layers |
|---|---:|---:|---|
| bootstrap-contract | 1 | 5 | C0 toolchain |
| domain | 2 | 22 | unit: state machine (exhaustive table check), review/dependency rules, IDs, clock, validation, retry, classification |
| storage | 7 | 79 | real file-backed SQLite: adapter/WAL/busy, workspace, migrations, work items, queue, fencing (each check isolated), checkpoints, artifacts, backup; plus **multi-process** (5): claim race, cross-process fencing, contention, backup under a writer process, concurrent first open |
| runtime | 5 | 31 | unit; integration (end to end, concurrency cap, idle, graceful shutdown, cross-process wake, CLI, robustness); **fault matrix (8 process-kill scenarios)** |

**Total: 137 tests.** All pass in `npm run ci` on Linux (Node 24.21.0), in the fresh clone (§21)
and in CI on Windows and Ubuntu (§21).

**Mutation checks** (non-vacuity):
- My own check: disabling the fence checks fails the fencing proof.
- Review lens B ran 13 mutations; 10 were caught.
- The 3 survivors (checkpoint without `verifyFence`, token check alone, unfenced `putArtifact`)
  now each have an isolating test.

**Mandatory fault matrix (C1 §47).** Every row is automated.

| Failure point | Proof |
|---|---|
| after Work Item commit, before in-memory wake | `fault-matrix`: process SIGKILLs itself at `submit.afterCommit`; restart completes the work once |
| after queue claim, before processor start | `fault-matrix`: SIGKILL at `claim.afterCommit`; recovery reclaims (`SAFE_TO_RETRY`) and completes once |
| after checkpoint commit | `fault-matrix`: SIGKILL at `checkpoint.afterCommit` #3; resume from step 3, no repeated step |
| before checkpoint commit | `fault-matrix`: SIGKILL inside the open checkpoint transaction; checkpoint 3 absent; resume from 2 |
| lease expires, new worker claims | `queue.test` (A/B sequence) + `multiprocess.test` (cross-process stale worker) |
| duplicate enqueue, same idempotency key | `work-items.test` + `fault-matrix` (same key across a crash) |
| same key, different input | `work-items.test` (`IDEMPOTENCY_CONFLICT`, audited) |
| retryable failure | `queue.test` (persisted `available_at`, backoff) + runtime integration |
| max retries exceeded | `queue.test` + runtime integration (`DEAD_LETTER`, health `ATTENTION`) |
| cancellation races completion | `queue.test` (intent first → CANCELLED; completion first → refused) + lease-expiry race + runtime cancel test |
| migration throws | `migrations.test` (bad SQL and injected throw → prior version, no partial DDL) |
| applied migration file changes | `migrations.test` (`MIGRATION_CHECKSUM_DRIFT`) + verifier `migrations-immutable` |
| artifact file exists, metadata absent | `artifacts.test` (orphan quarantined, audited, idempotent) |
| artifact metadata exists, file missing | `artifacts.test` (`MISSING`, never READY; read refused) |
| process dies during runtime operation | `fault-matrix` crash e2e (external SIGKILL; recovery audited before `runtime.ready`) + crash during recovery |
| backup while DB active | `backup.test` (in-process writer) + `multiprocess.test` (separate writer process, SIGKILLed after) |

Also proven: `UNSAFE`-class crash → `RECONCILIATION_REQUIRED`, never retried. The C1 local acceptance
harness passes (`C1 LOCAL ACCEPTANCE — PASS`, 6/6 steps).

## 21. Windows + Linux CI

Workflow `CI`: a `windows-latest` + `ubuntu-latest` matrix. Each job runs these steps:
- `npm ci`;
- `npm run ci` (build, typecheck, lint, every test including multi-process and fault matrix,
  verifier);
- `npm run c1:acceptance`, with a disposable workspace in `runner.temp`.

Node v24.21.0 and SQLite 3.53.4 were confirmed on both runners.

| Head | Run | Windows | Ubuntu | Note |
|---|---|---|---|---|
| `f849785` (first candidate) | 36272324647 | success | success | reviewed head |
| `38ab692` (A/C fixes) | 36273195427 | **failure** | success | Windows only: the restore-containment test, caused by an 8.3 short temp path (`RUNNER~1`) |
| `9e3e9a5` (B fixes) | 36275920353 | **failure** | success | the same single assertion; every other test passed on Windows, including the fault matrix and robustness |
| `300c2d5` (canonical-path fix) | — | — | — | superseded by the next push (concurrency cancel) |
| `53fe787` | 36276227306 | **success** | **success** | first green head with every lens A/B/C fix |
| final head | see PR | — | — | adds the D-C1-19 residual fixes and their tests (137 tests) |

The final head adds the D-C1-19 residual fixes on top of `53fe787`. Its CI run and its fresh-clone
proof are recorded in the PR description, so this file does not need a self-referencing commit. The Windows failures were real defects, found by CI: restore containment compared
non-canonical paths. The fix and its test are in `300c2d5`. No test was skipped or weakened.

**Clone configuration.** A clone must carry the repository-local `core.longpaths=true` that the C0
rule `local-core-longpaths` requires; use the README clone command. A plain `git clone` fails that
one rule by design.

**Fresh-clone proof** at `9e3e9a5`. Code identical to `53fe787` except for the Windows containment
fix, which was re-proven by the Windows CI above.
- **Setup:** a new `git clone` from GitHub, checkout of the exact SHA, then `npm ci` (0
  vulnerabilities).
- **`npm run ci`:** 5 + 22 + 76 + 31 tests green, and the verifier passes 28/28.
- **`npm run c1:acceptance`:** `C1 LOCAL ACCEPTANCE — PASS`.
- **Clean tree:** `git status` was empty afterwards, so no hidden Cloud-session file or untracked
  runtime state is needed.

## 22. Independent internal reviewers

Three independent read-only reviewers ran against the exact green candidate head `f849785`. Each
used a scratch copy for probes. The fixes landed in `38ab692` (lenses A and C), `9e3e9a5` (lens B)
and `300c2d5` (a Windows path-canonicalization defect that CI exposed). The dispositions are recorded
in DECISION_LOG D-C1-17 and D-C1-18. A fourth independent verifier then re-checked every disposition
at the final head (below).

**Reviewer A — authority / architecture conformance.**
- Result: no BLOCKER. It found no scope leakage, no placeholders, and no change to the imported
  authority; privacy Rules A, B and C hold.

| # | Sev. | Finding | Disposition |
|---|---|---|---|
| M1 | MAJOR | Closing could record `ACHIEVED` without `OUTCOME_VERIFIED` (Stage 8 §34) | **Fixed.** Domain rule + DB trigger `work_items_success_needs_verification` + tests |
| M2 | MAJOR | `WAITING_APPROVAL → READY` could fake an approval | **Fixed.** Not a manual target; its exit is refused in C1 (`APPROVAL_PATH_UNAVAILABLE`) + test |
| M3 | MAJOR | R2 did not require review; self-review was possible (Stage 3 §2/§4) | **Fixed.** R2+ ⇒ review required. `REVIEWED`/`OUTCOME_VERIFIED` fail closed (`REVIEW_PATH_UNAVAILABLE`) until an enforced reviewer authority exists + tests |
| M4 | MAJOR | A dependency was satisfied at `WAITING_REVIEW` | **Fixed** (conservative default: review-required work satisfies only once `REVIEWED`) + test. The authority is silent on this, so it is reported as a **Product gap**, not a conflict (D-C1-09) |
| M5 | MAJOR | Cancel-wins overwrote a real completion | **Fixed.** The run is recorded `SUCCEEDED` with evidence; side-effecting classes go to reconciliation + tests. **Product Owner input requested** (D-C1-08) |
| m1 | MINOR | Required evidence not enforced at completion | Documented. Judging evidence is review work (C2/C4) |
| m2 | MINOR | Blocked ownership has no resolver or next action | Documented as deferred (C4) |
| m3 | MINOR | "A lost hint is harmless" was overstated; the watcher could die silently | **Fixed.** Re-arm once; health reports `WAKE_WATCHER_UNAVAILABLE` → DEGRADED; docs corrected |
| m4 | MINOR | Health model gaps (stuck work, overdue backup, circuit breakers) | Documented as not in C1 (C2/C6) |
| m5 | MINOR | A supersession could cancel its own replacement | **Fixed.** A replacement inside the lineage is refused + test |
| m6 | MINOR | Report placeholders | **Fixed** in this revision |
| m7 | MINOR | Privileged local operations take an unauthenticated actor | Accepted for C1 (library/CLI only; Stage 12 §49 IPC authorization belongs to a later package); documented in §23 |
| N | NIT | Diagram edge; the CLI defaulted the owner to the Founder; logger field allowlist | Diagram fixed. CLI owner is now explicit (`--owner`, default `owner:c1-cli-operator`). Allowlist: kept as call-site discipline plus scalar-only filtering |

**Reviewer B — durability / concurrency / failure.**
- Result: no data-integrity BLOCKER. Fencing, atomicity and recovery ordering hold; the fault matrix
  and multi-process tests prove what they claim.
- Mutations: 13 run, 10 caught.

| # | Sev. | Finding | Disposition |
|---|---|---|---|
| 1 | MAJOR | A `CANCELLED` result or a `WAIT` into the past re-ran with no attempt limit (~300 runs/s) | **Fixed.** Unprompted `CANCELLED` and a malformed or past `WAIT` become bounded failures; storage refuses a bad `WAIT.until` + tests |
| 2 | MAJOR | `STORAGE_BUSY` at settle lost a completed result (re-execution) | **Fixed.** Bounded settle retry while the lease keeps renewing + test with a real locker process |
| 3 | MAJOR | Host sleep past the TTL fail-stopped the runtime silently (CLI exit 0) | **Fixed.** Token-conditional renewal (audited) when no takeover happened; a real takeover fail-stops loudly (`onFailStop`, CLI exit 1) + tests |
| 4 | MAJOR | Concurrent first open failed in 10 of 10 trials | **Fixed.** Snapshot pre-check, re-check inside `BEGIN IMMEDIATE`, WAL switch retries busy + multi-process test (4 processes, 5 of 5 runs green) |
| 5–11 | MINOR | Refused-acquire audit rolled back; `putArtifact` fenced outside its transaction; checkpoint/token/artifact fence tests missing; backup files not fsynced; Windows rename retry; artifact recovery edge cases | **All fixed**, with tests where testable |
| 12 | MINOR | Wake watcher could die silently | Already fixed in `38ab692` |
| — | NIT | Unfenced `claimNext` stays public at the storage level | Documented residual: the runtime always passes the fence, and recovery reclaims unfenced claims |

**Reviewer C — security / integrity / attack surface.**
- Result: no BLOCKER. No secrets, network surface, native code or SQL injection; no content leaks
  into logs, events or audit; CI least-privilege.

| # | Sev. | Finding | Disposition |
|---|---|---|---|
| MAJOR-1 | MAJOR | A workspace could sit inside a Git (or App) working tree; artifacts showed up as untracked files | **Fixed.** `openWorkspace` refuses any Git working tree (`inside-source-checkout`) + test |
| MINOR-1 | MINOR | Public `CompanyStore.open({ migrations })` executed caller SQL | **Fixed.** Only released, pinned migrations; the fixture seam is internal + regression test |
| MINOR-2 | MINOR | Backup not bound to `backup_records` or the expected schema | **Fixed.** Hash binding (CLI/runtime require the record) + schema fingerprint; tests for a replaced pair and a planted trigger |
| MINOR-3 | MINOR | Artifact hashing inside the write lock | **Fixed.** Hash before `BEGIN`; size re-check inside |
| MINOR-4 | MINOR | Restore target touched before validation; could be inside the live workspace | **Fixed.** Syntax validation first; canonical containment check (Windows 8.3-safe) + tests |
| MINOR-5 | MINOR | Acceptance child mode bypassed the guards; cleanup removed a caller-supplied directory | **Fixed.** Child mode needs a harness-owned sandbox; caller-supplied directories are kept |
| NIT 1–6 | NIT | Orphan scan followed links; wake file written through links; `create:false` created a DB; `trusted_schema` order; `child_process` unrestricted; `recordAudit` unvalidated, reads unbounded | **All fixed** |

**`security-review` Skill:** no finding at confidence ≥ 8.

**Disposition re-verification.** A fourth, independent read-only verifier re-checked every A/B/C
disposition at `300c2d5`.
- **Result:** every disposition confirmed fixed (or documented, where so marked). No BLOCKER or MAJOR.
- **Mutation checks:** removing the fence token check, the lease-expiry check or the in-transaction
  artifact fence each fails a test.
- **Residuals it raised**, all handled in the final code commit (DECISION_LOG D-C1-19):
  - reopening already-released work through optional review → **refused** + test;
  - a replacement that depends on the superseded item → **refused** (`DEPENDENCY_CYCLE`) + test;
  - a run-linked artifact without that run's fence → **refused**; a stale fence is audited and its
    staging file removed + test;
  - a refused Git-tree open left directories behind → the check now runs **before** any directory
    is created + test;
  - the acceptance harness verified backups unbound → now bound to `backup_records`;
  - migration 0001 revised in place before any merge → documented; immutable from the first merge on;
  - library-level unbound `verifyBackup`, the `notifyRuntime` check-then-write window, and the
    `backups/` directory entry fsync → **documented** (hint-only or legitimate uses; the CLI and
    runtime always bind).

## 23. Known limitations / deferred scope

- **Mapped network drives.** Windows mapped drives are not detectable without native code;
  unsupported, documented (D-C1-13).
- **Approval.** Approval-gated work can be recorded but not executed until C2 (by design, D-C1-07).
- **Dependency satisfaction.** A dependency is satisfied at `COMPLETED`; review-gated satisfaction is
  a later policy (D-C1-09).
- **Backup and resilience.** No encrypted off-device backup, retention, immutable copy, promotion or
  maintenance/rollback lifecycle (C6/L1, Stage 15).
- **IPC and authorization.** No UI IPC or runtime authorization context. C1 exposes a library and a
  local CLI; opaque actor references are stored unverified (C2/C5).
- **Operational policy.** No event/audit retention or rotation, no WIP limits beyond the global
  concurrency cap, and no recurring-work scheduler.
- **Throughput.** Not benchmarked. These tests prove correctness, not production-scale throughput.

## 24. Founder-host validation still required

**FOUNDER-HOST VALIDATION REQUIRED.** On the Windows host, in a fresh clone of the exact PR head:

```bash
git clone -c core.longpaths=true -c core.quotepath=false https://github.com/allamqandeel/qandeel-company.git
cd qandeel-company
git checkout <exact PR head SHA>
npm ci
npm run ci
npm run c1:acceptance -- --workspace "<new empty directory outside any Git checkout>"
```

Also required:
- confirm the Smart App Control posture is unchanged;
- re-read the four `sqlite.org` pages (D-C1-05).

## 25. Exact next gate

`INDEPENDENT REVIEW + FOUNDER-HOST LOCAL ACCEPTANCE`. C1 is **not** closed by this report.
