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

| Skill | Concrete effect |
|---|---|
| *(to be completed in §22)* | |

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
| domain | 2 | 21 | unit: state machine (exhaustive table check), IDs, clock, validation, retry, classification |
| storage | 7 | 65 | real file-backed SQLite: adapter/WAL/busy, migrations, work items, queue/fencing, checkpoints, artifacts, backup, **multi-process** (4) |
| runtime | 4 | 27 | unit, integration (end-to-end, concurrency cap, idle, graceful shutdown, cross-process wake, CLI), **fault matrix (8 process-kill scenarios)** |

All pass locally on Linux with Node 24.21.0 (`npm run ci`). A mutation check proved the fencing
tests are not vacuous: disabling the token, owner and run checks fails the fencing proof.

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

*(completed in the final revision: run IDs and results for the exact head.)*

## 22. Independent internal reviewers

*(completed in the final revision.)*

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
npm ci
npm run ci
npm run c1:acceptance -- --workspace "<new empty directory outside any Git checkout>"
```

Also required:
- confirm the Smart App Control posture is unchanged;
- re-read the four `sqlite.org` pages (D-C1-05).

## 25. Exact next gate

`INDEPENDENT REVIEW + FOUNDER-HOST LOCAL ACCEPTANCE`. C1 is **not** closed by this report.
