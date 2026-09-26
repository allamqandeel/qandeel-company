# C1 — Runtime and Recovery Model

**Status:** C1 implementation candidate. This describes the code on this branch; it is not a closure
record. The code lives in `packages/runtime/src/`, backed by `packages/storage/src/`.

## 1. Startup sequence and readiness gate

`CompanyRuntime.start()` moves through `CREATED → STARTING → RECOVERING → READY`:
1. **Workspace.** The workspace is validated (§12) and its directories are created.
2. **Database.** The WAL database opens with its startup invariants verified: WAL, `synchronous=FULL`,
   foreign keys, defensive mode, extension loading disabled, bounded busy timeout.
3. **Migrations.** The schema is brought current (checksums, future-schema refusal).
4. **Instance.** A `runtime_instances` row is registered (`STARTING`).
5. **Supervisor lease.** The runtime acquires the supervisor lease, or waits once for the recorded
   expiry of a previous holder's lease, bounded by `acquireTimeoutMs`. A live lease held by another
   supervisor is never taken (`LEASE_HELD`). The runtime then starts the deterministic heartbeat.
6. **Recovery.** State becomes `RECOVERING` and the startup recovery pass runs (§8).
7. **Ready.** Pending outbox events are dispatched, the instance is marked `READY` with its recovery
   summary, `runtime.ready` is audited, and the cross-process wake watcher starts. The runtime then
   accepts work and the dispatcher runs.

**Readiness** (`runtimeHealth().readiness`) is true only when all of these hold:
- the runtime is `READY`;
- the workspace is valid;
- the database is open;
- WAL is active;
- the schema version is current;
- this runtime holds the live supervisor lease;
- recovery completed;
- the artifact directories are writable.

The submission APIs throw `RUNTIME_NOT_READY` before readiness and `RUNTIME_STOPPING` during
shutdown.

## 2. Supervisor lifecycle

- **The supervisor is infrastructure, not an AI employee.** Its lease row is the only authority;
  process existence proves nothing.
- **Heartbeat.** The lease is renewed every `TTL/3`, with the default TTL of 30 s.
  - A `STORAGE_BUSY` renewal is skipped; two beats of margin remain.
  - Any other renewal failure triggers **fail-stop**: every active run is aborted, the runtime moves
    to `FAILED` and the database is closed. Its workers' late writes are fenced anyway.
- **Every claim transaction re-checks** that this supervisor's lease is current. A stale supervisor
  cannot claim work, even for a moment.
- **Takeover.** A new supervisor takes over only after expiry, and takeover increments the lease
  token.
- **Host sleep.** Renewal is **token-conditional**: it succeeds while the lease row still names this
  holder and token, even after the lease expired during a laptop sleep, because a takeover would
  have changed the token. The renewal is audited (`supervisor.renewed_after_expiry`). Worker claims
  that expired during the sleep are fenced and recovered as usual.
- **Takeover is loud.** Only a real takeover fail-stops the old runtime. It then calls `onFailStop`,
  and the CLI exits with code 1, so the runtime never silently disappears.

## 3. Event-driven wake-up (no polling runtime)

The durable queue is the source of truth. A wake is a coalesced hint that costs no model call.
- **In-process:** a hint cannot be lost, because it is issued after every local commit.
- **Cross-process:** a lost hint never loses work, since the job stays durable, but pickup waits for
  the next pump (another commit, a slot release, the next-due timer) or a restart. The watcher is
  re-armed once on error. If it is still down, health reports `WAKE_WATCHER_UNAVAILABLE`
  (`DEGRADED`) instead of silently looking healthy (Stage 12 §45).

**The dispatcher pump runs when:**
1. a local transaction commits (submit, transition, wake, cancel, requeue, resolve);
2. another process writes `<workspace>/runtime/wake.signal`, observed with `fs.watch`, which is OS
   change notification (inotify / ReadDirectoryChangesW), not polling;
3. a worker slot frees;
4. the **single** scheduler timer fires, armed for the earliest of the next due `QUEUED` job
   (retry/backoff/timed wait) and the next lease expiry.

**When nothing is due, no timer is armed**, and the idle runtime issues **zero SQL statements** (proved
by `idle runtime` in `packages/runtime/test/integration/runtime.test.ts`). Deterministic lease
heartbeats are the only periodic activity: the supervisor's, plus one per active run, bounded by the
concurrency cap. They never scan the queue and never call a model. There is one timer per
runtime, not per Employee, and one process for the whole runtime, not per Employee.

## 4. Queue and worker flow

1. **Pump.** The pump dispatches pending outbox events, notices durable cancellations requested by
   other processes, recovers expired claims, then claims jobs while
   `active < concurrency` (default 2, maximum 64).
2. **Claim.** One short `BEGIN IMMEDIATE` transaction:
   - verify the supervisor lease;
   - select the next due job in deterministic order;
   - conditionally update it to `CLAIMED`, with a new fencing token, lease expiry and run ID;
   - insert a `RUNNING` run;
   - move the item to `IN_PROGRESS`;
   - append the event and audit rows.
3. **Execute.** The run executes its deterministic processor with a `ProcessorContext`: IDs, attempt,
   bounded input, the latest valid checkpoint, an abort signal, fenced `checkpoint()` and fenced
   `putArtifact()`.
   - A per-run lease heartbeat renews every `leaseMs/3`, 60 s lease by default. A `STALE_LEASE`
     renewal fences and aborts the run.
   - A run timeout (`maxRunMs`, default 10 min) aborts the run.
   - An unresponsive processor is abandoned after the grace period. Its late writes are fenced, so
     it cannot pin a slot or change state.
4. **Settle.** One fenced transaction maps the result:

| Processor result | Run | Job | Work Item |
|---|---|---|---|
| `COMPLETED` | `SUCCEEDED` | `DONE` | `COMPLETED` (→ `WAITING_REVIEW` if review required); dependents resolved in the same transaction |
| `WAIT` (with `until`) | `PARKED` | `QUEUED` at `until` | `WAITING` |
| `WAIT` (no `until`) | `PARKED` | `WAITING` until `wake()` | `WAITING` |
| `RETRYABLE_FAILURE` | `FAILED_RETRYABLE` | `QUEUED` at now + backoff, or `DEAD_LETTER` when attempts are exhausted | `READY`, or `BLOCKED (RETRIES_EXHAUSTED)` |
| `PERMANENT_FAILURE` | `FAILED_PERMANENT` | `FAILED` | `FAILED`; dependents marked `DEPENDENCY_FAILED` |
| `RECONCILIATION_REQUIRED` | `RECONCILIATION_REQUIRED` | `RECONCILIATION_HOLD` | `BLOCKED (RECONCILIATION_REQUIRED)` |
| `CANCELLED` (ack, no durable intent) | `INTERRUPTED` (resume/retry disposition) | `QUEUED` now | `READY` (graceful park; not a failed attempt) |
| *durable cancel/supersede intent present* | `CANCELLED`; or `SUCCEEDED` with its evidence if the processor genuinely completed (`failure_code = TERMINATION_REQUESTED`) | `CANCELLED` | `CANCELLED`/`SUPERSEDED`, propagated to children |
| *intent present + `COMPLETED` from an `IDEMPOTENT`/`UNSAFE` processor* | `SUCCEEDED` (truthful) | `RECONCILIATION_HOLD` | `BLOCKED (RECONCILIATION_REQUIRED)`: a person decides which outcome stands |

**Settle under contention.** A settle that meets `STORAGE_BUSY` is retried with bounded backoff (up
to 10 attempts) while the run's lease heartbeat keeps the claim alive. A completed result is
therefore not lost to transient write contention, and the processor is not re-executed.

**Runtime-assigned failures:**
- A processor that reports `CANCELLED` although the runtime never asked it to stop becomes
  `RETRYABLE_FAILURE PROCESSOR_STOPPED_UNPROMPTED`. A `WAIT` whose `until` is malformed or in the
  past becomes `RETRYABLE_FAILURE INVALID_WAIT`, and storage refuses such a `WAIT` too. Both are
  bounded by `maxAttempts`, so a processor defect cannot loop for free.
- A processor exception becomes `RETRYABLE_FAILURE PROCESSOR_ERROR`.
- A timeout becomes `RETRYABLE_FAILURE RUN_TIMEOUT`.
- For an `UNSAFE`-class processor, both become `RECONCILIATION_REQUIRED` instead.

## 5. Checkpointing

- `ctx.checkpoint(kind, state)` resolves only after its transaction commits. The same transaction
  inserts the next sequence number, records the state's SHA-256, updates the run and renews the
  lease.
- A checkpoint that did not commit does not exist. `checkpoint.beforeCommit` proves this with a real
  process kill inside the open transaction.
- **Resume uses the latest checkpoint whose checksum verifies.** A tampered checkpoint is skipped,
  never trusted. Prior checkpoints are retained, append-only, for audit.

## 6. Retry and dead-letter

- **Bounded attempts.** Each Work Item's `maxAttempts` is 1..25, default 3.
- **Deterministic backoff** sits behind the `BackoffPolicy` interface. The default is exponential:
  1 s base, ×2, 5 min cap, no jitter.
- **The next attempt time is persisted** as `available_at`, so retry state survives restarts. There
  is no immediate recursive retry.
- **Exhausted retries go to the dead letter.** The job becomes `DEAD_LETTER`, the item becomes
  `BLOCKED (RETRIES_EXHAUSTED)`, and the health status becomes `ATTENTION`.
- **Requeue is explicit only:** `requeueDeadLetter`, which is audited.
- **Poison and crash loops are bounded.** An interrupted attempt counts toward `maxAttempts`, and
  exhaustion dead-letters with `INTERRUPTED_ATTEMPTS_EXHAUSTED`.

## 7. Cancellation and supersession

- **Intent is durable before any signal.**
  - For not-running work, the request itself terminates the item, withdraws its job and propagates
    in one transaction.
  - For running work, it records `termination_requested` and sets `cancel_requested` on the job.
    The runtime then aborts the local processor. A request made from another process is noticed at
    the next pump.
- **Settlement always finalizes durable intent** (D-C1-08).
  - Durable intent wins over a later `COMPLETED` result for the Work Item, but the run itself is
    recorded truthfully: `SUCCEEDED`, with its evidence.
  - Work that may have external effects is never silently resolved. It goes to reconciliation
    instead. Resolving with `RETRY` then honours the termination, and `CONFIRMED_COMPLETED` keeps the
    completion (a supersession still applies).
  - If the lease expires instead, recovery finalizes the intent, unless the run is `UNSAFE`-class,
    which goes to reconciliation.
  - The outcome is one terminal state, and the terminal-row trigger forbids resurrection.
- **Completed work cannot be cancelled** (`INVALID_TRANSITION`), but it can be superseded.
- **Propagation** walks the lineage to children through a `PropagationPolicy`, an extension point for
  C4.
  - The default honours `propagation_mode = INDEPENDENT`: such children are retained, and the
    retention is audited.
  - Completed children and children under reconciliation are retained too.
- **Dependents of cancelled work** stay `BLOCKED (DEPENDENCY_FAILED)`. They are not auto-cancelled.

## 8. Hard-crash recovery (startup recovery pass)

Recovery runs after the lease is acquired and before `READY`. Each step is its own short transaction
and is idempotent. The pass is bounded (batches of 100, with a loop ceiling) and never runs a
processor itself; the dispatcher resumes work afterwards under the concurrency cap and priority order
(no restart wake storm).
1. **`quick_check`.** It must be `ok`; otherwise the runtime is not ready.
2. **Instances.** Earlier instances without a clean stop are marked `ABANDONED`.
3. **Every claim not owned by this instance** (expired or not) is recovered. This supervisor holds the
   lease, so those workers are dead or will be fenced. For each claim:
   - the token is bumped;
   - the run is marked `INTERRUPTED`;
   - durable termination intent, if present, is finalized;
   - otherwise the claim is classified (§9).
4. **Orphan `RUNNING` runs** are closed.
5. **Dangling termination intent** is settled.
6. **The artifact boundary** is recovered (§11).
7. **The summary is recorded**: due jobs, pending events, reconciliation holds and dead letters. It
   is written on the instance row.

A crash *during* recovery followed by another restart is proven safe: the claim is recovered exactly
once and the work completes once (`a second crash during recovery …`).

## 9. Reconciliation-required boundary

Each processor declares a side-effect class: `NONE`, `IDEMPOTENT` or `UNSAFE`. An interrupted run is
classified as follows:
- `UNSAFE` → **`RECONCILIATION_REQUIRED`**: `RECONCILIATION_HOLD`, never auto-retried, never
  cancellable until resolved.
- otherwise, with a checkpoint → `SAFE_TO_RESUME`;
- otherwise → `SAFE_TO_RETRY`.

`resolveReconciliation(jobId, RETRY | CONFIRMED_COMPLETED | FAILED)` is the explicit, audited exit,
used after someone checks external reality. C1 processors are all `NONE`. The mechanism exists so that
C2 Tool Executors cannot be blindly retried across an ambiguous crash, and the fault matrix proves it
with a deterministic `UNSAFE`-class probe.

## 10. Graceful shutdown

`stop()` performs these steps:
1. stop accepting work;
2. persist `STOPPING`;
3. abort active processors with reason `SHUTDOWN`;
4. wait for them up to `shutdownGraceMs`.

A processor that acknowledges (`CANCELLED`) at a safe point is **parked**: its job is `QUEUED` at once,
not charged an attempt, and resumes from its checkpoint. Runs still unsettled after the grace period
are recovered in place, by the same classification recovery uses. Then the runtime:
5. dispatches pending events;
6. releases the supervisor lease, so the next start needs no expiry wait;
7. marks the instance `STOPPED`;
8. closes the database.

**Correctness never depends on this path.** A hard kill leaves leases to expire and recovery to
classify.

## 11. Artifact crash windows

Content lives outside SQLite at `artifacts/objects/ab/cd/<sha256>`. The write protocol and every
crash window:

| Crash point | Durable state left behind | Startup recovery |
|---|---|---|
| after temp write (`tmp/<artifactId>.part`), before metadata | temp file, no row | temp file deleted |
| after the `STAGED` row, before the rename | row `STAGED` + temp file | temp re-hashed; if it matches, renamed and promoted `READY`, else the row becomes `ABANDONED` |
| after the rename, before `READY` | row `STAGED` + object | object re-hashed, promoted `READY` |
| object with no row (e.g. an older DB restored) | orphan object | moved to `artifacts/quarantine/`, audited, never deleted |
| row `READY`, object missing | — | demoted to `MISSING`; health `ATTENTION` |
| object bytes changed | — | `read()` / `verifyAll()` re-hash, demote to `CORRUPT` |

- Identical content is stored once; metadata rows reference it by hash.
- User-supplied labels are display metadata only and never become paths. Only validated UUIDs and
  SHA-256 hex build paths, inside `containedPath`.
- Nothing claims the SQLite + filesystem pair is transactional.

## 12. Workspace, local-filesystem rule

- **A workspace inside any Git working tree is refused** (`inside-source-checkout`). This protects
  this repository, the QANDEEL App checkout and every other source tree from receiving live Company
  state.

- The workspace path is always supplied by the caller. No Founder path is built in, and the runtime
  never writes inside the source checkout.
- **Rejected paths:**
  - relative paths;
  - UNC shares (`\\server\share`, `//server/share`, `\\?\UNC\…`) and device namespaces;
  - on Windows, anything but a drive letter or `\\?\C:\…`;
  - on Linux, network mounts detected from `/proc/self/mountinfo` (NFS, CIFS/SMB, SSHFS, 9p and
    others);
  - symlinked or junctioned workspace directories.
- **Mapped network drives on Windows cannot be detected reliably without native code and are
  unsupported** for the canonical SQLite/WAL database: WAL requires every connection on the same
  host and a local filesystem.

## 13. Backup primitive

`createBackup(store)`:
1. opens a dedicated connection and uses SQLite's Online Backup API (`node:sqlite` `backup()`),
   copying all pages in one step so concurrent writers cannot force endless restarts;
2. converts the snapshot to rollback-journal mode, making it one self-contained file;
3. runs the full `integrity_check` and `foreign_key_check`;
4. writes `manifest.json`, which records:
   - the backup ID, creation time, runtime version and schema version;
   - the applied migration checksums;
   - the snapshot SHA-256, size and page count;
   - integrity `ok`;
   - the row counts;
   - the READY-artifact manifest and its SHA-256;
5. records `backup_records` in the live DB.

The active database file is never copied directly.

`verifyBackup` checks, in isolation:
- the checksum;
- a read-only open of the snapshot, never the live file;
- the full `integrity_check` and foreign keys;
- schema version and migration pins;
- a critical read proof: the counts and the artifact manifest must equal the manifest;
- optionally, that every referenced artifact object exists with its hash.

`restoreToIsolatedWorkspace` copies the snapshot into a new, empty workspace and dry-starts it: open,
migrate, `quick_check`, compare counts. **The live database is never replaced.** Promotion is
deliberately absent from C1.

Verification is also bound to the live Company. The CLI and the runtime require that
`backup_records` holds this backup's snapshot and manifest hashes. The snapshot's schema
(tables, indexes, triggers) must equal the schema the released migrations produce for its version,
so a planted trigger or view is refused.

**Deferred to C6/L1 (Stage 15):**
- encrypted off-device copies;
- generational retention;
- immutable/offline copies;
- device-loss promotion and secret re-keying;
- pre-update snapshots and the maintenance/rollback lifecycle.

## 14. Health

`runtimeHealth(runtime)` and `inspectWorkspace(root)` return a content-free JSON snapshot:
- **status:** `HEALTHY`, `DEGRADED`, `ATTENTION` or `CRITICAL`, with reason codes;
- **liveness;**
- **readiness checks;**
- **component states:** runtime, database, migrations, supervisor lease, queue, work items, recovery
  summary, artifacts, backup capability, and workspace free space (low-disk threshold 1 GiB).

`inspectWorkspace` is read-only and runs from another process: it never migrates, recovers or claims.

**Not in the C1 health model** (listed so they are not assumed):
- a stuck-work age signal for long `WAITING`/`BLOCKED` work;
- an overdue-backup signal, which needs the backup schedule (C6);
- provider/tool circuit breakers (Stage 12 §13, C2).

Present signals include expired leases, dead letters, reconciliation holds, artifact integrity,
wake-watcher availability and low disk.

**Integrity policy.** Startup runs `quick_check`. The full `integrity_check` runs on backup, backup
verification and explicit verification (`store.integrityCheck()`, CLI `verify-backup`), never on
every health request.
