# Decision Log

Material engineering and governance decisions, newest last. Product decisions are recorded here
only as references to the Product Owner decision that made them.

## D-C0-01 — Implementation baseline (Product Owner)

TypeScript, Node.js 24 LTS, npm workspaces; SQLite family for later durable state; Node built-in /
pure-JavaScript capabilities; no native addons unless a later task proves them necessary. No
desktop framework chosen. Not reopened in C0.

Refresh on 2026-09-26 from official sources: Node 24 "Krypton" is Active LTS (Active until
2026-10-20, then Maintenance until 2028-04-30); newest 24.x is 24.21.0 with npm 11.19.0. The
Founder host runs 24.19.0 / npm 11.17.0. `engines` is bounded to `>=24.11.0 <25.0.0` (24.11.0 is
the first LTS release) and `.npmrc` sets `engine-strict=true`, so an unsupported Node fails
`npm ci` instead of warning.

## D-C0-02 — TypeScript pinned to 6.0.3, not 7.x

The newest TypeScript on 2026-09-26 is 7.0.2. It is the native compiler: the `typescript` package
depends on per-platform native binaries (`@typescript/typescript-win32-x64`, etc.). That conflicts
with the Smart App Control constraint (no unsigned native runtime dependencies; signature status
not proven on this host), and `typescript-eslint` 8.70.1 supports only `typescript >=4.8.4 <6.1.0`.
TypeScript 6.0.3 is the newest pure-JavaScript compiler and satisfies both.
**Revisit** when TypeScript 7's Windows binary is proven to run under Smart App Control on the
Founder host and the lint toolchain supports it. This keeps the approved stack (TypeScript); it
only bounds the compiler version.

## D-C0-03 — Minimal toolchain

- Compile / typecheck: `tsc` (TypeScript 6.0.3), `@types/node` 24.19.0.
- Lint: ESLint 10.11.0 + `@eslint/js` 10.0.1 + `typescript-eslint` 8.70.1 (`strict` preset).
- Tests: Node's built-in `node:test`, run on compiled output. No test-framework dependency.
- Verification: `scripts/verify-bootstrap.mjs`, dependency-free.
All versions are exact pins. Installed tree: 100 packages, no install scripts, no native or WASM
binaries, `npm audit` 0 vulnerabilities (2026-09-26).

## D-C0-04 — CI shape

GitHub Actions on push to `main` and PRs targeting `main`; matrix `windows-latest` (the Founder
platform) and `ubuntu-latest` (the Cloud build platform). `actions/checkout` v7.0.1 and
`actions/setup-node` v7.0.0, the current majors on 2026-09-26, pinned by full commit SHA.
`permissions: contents: read`, `persist-credentials: false`, no secrets, no cache (setup-node's
automatic package-manager cache is turned off explicitly), no deployment.

## D-C0-05 — Structural additions to the C0 layout

Technically required beyond the task's layout sketch:
- `eslint.config.mjs` — ESLint 10 reads only flat config from this file.
- `.npmrc` — `engine-strict=true` only. It must never contain registry auth (the verifier enforces
  this).
- `packages/bootstrap-contract/package.json` and `tsconfig.json` — a workspace needs a manifest and
  its compiler configuration.
- `docs/C0_REPOSITORY_BOOTSTRAP_CLOSURE.md` — required by the C0 contract §31.

## D-C0-06 — Git transport on the Founder host

HTTPS through GitHub Desktop's signed bundled Git, discovered at use time. Authentication is
supplied per command by the GitHub CLI credential helper; nothing is stored in repository config,
and no deploy key was added.

The Founder's global Git config rewrites the URL **prefix** `https://github.com/allamqandeel/qandeel`
to SSH for the App repository. Because Git's `insteadOf` is prefix-matching, that prefix also
captures `https://github.com/allamqandeel/qandeel-company`, which would send this repository to SSH
with the App-only deploy key. The global config was not changed. Instead this repository's local
config maps its own URL to itself (`url.<repo-url>.insteadOf=<repo-url>`): Git applies the longest
matching prefix, so the App rewrite no longer applies. A fresh clone must pass the same mapping with
`-c` (see README, Windows notes). Cloud sessions are unaffected; they do not read the Founder's
global config.

## D-C0-07 — Repository-local Git configuration

`core.longpaths=true` (L0 requirement; the verifier fails a local clone without it),
`core.quotepath=false` (Arabic file names print readably), and the URL mapping from D-C0-06. The
global Git configuration is unchanged.

## D-C0-08 — Upstream Product authority is not yet in this repository

The detailed Product / architecture authority (Company Stage 0–17 canonical closures) exists as
Founder-local archives beside the project folder. C0 was not asked to import it, and does not. A
read-only comparison found **no conflict** with this baseline: upstream also specifies SQLite /
WAL local operational state, Windows user-scoped secret protection, event-driven work with no LLM
polling, and Founder approval of the highest-risk actions during initial trust-building.

Two observations, not conflicts:
- Upstream names the final phase "Stage 18 — Controlled Pilot → Strong v1 Closure"; the
  implementation map expresses the same thing as `P1/P2/P3` plus "Strong v1 Closure".
- No Stage 16 archive is present locally beside the others. C0 does not reconstruct it.

**Consequence for C1:** a Cloud session can read only what is in this repository. Before C1, the
Product Owner either imports the upstream authority into `docs/authority/` or includes the parts C1
needs in the C1 task package. See `docs/C0_REPOSITORY_BOOTSTRAP_CLOSURE.md` §14.

## D-C0-09 — Protected `main`

Intent: from C1 on, changes reach `main` only through PRs with green CI; the owner keeps
break-glass administration. Enforcement status on GitHub is recorded in
`docs/C0_REPOSITORY_BOOTSTRAP_CLOSURE.md` §10.

## D-PRE-C1-01 — Detailed Stage authority imported for Cloud self-containment

Resolves the consequence recorded in D-C0-08, which is otherwise unchanged. The canonical Company
Stage 0–15 and Stage 17 authority, and the latest living founding set, were imported into
`docs/authority/company-architecture/` so that a Cloud executor works from the repository alone.
- **Provenance.** Source archives, entry paths, SHA-256 hashes and classifications are in
  `AUTHORITY_IMPORT_MANIFEST.md`.
- **Exact copies.** All 42 files are exact byte copies, and `npm run verify` re-checks their hashes.
- **What was left out.** Superseded running-document versions, byte-identical duplicates and the
  pre-Stage-0 draft package were classified and not imported.
- **Stage 16.** STAGE 16 SOURCE ARTIFACT — NOT FOUND IN LOCAL AUTHORITY SET. No architecture was
  invented to fill the gap. Stage 16 scope maps to `C5`, not `C1`.
- **Conflicts.** No blocking authority conflict was found. The non-blocking observations are
  recorded in the index (`README.md` §6).
- **Effect.** After this change merges, C1 and later work may rely on the imported canonical
  authority. Where it holds detail, it governs over the C0 summary
  (`IMPLEMENTATION_AUTHORITY_RULES.md` rule 11).

## D-PRE-C1-02 — Direct Product Owner privacy clarification (Product Owner)

The Product Owner's direct privacy decision supersedes the broader C0 summary wording in
`COMPANY_CANONICAL_BASELINE.md` §5 and `BOUNDARIES.md`. That wording allowed a default with an
unspecified exception. It now reads as three distinct rules:
- **(A)** Operational telemetry is ALWAYS content-free, with no incident or safety-monitoring
  exception.
- **(B)** APP-OPS-01 itself provides no path by which Company Operations receives private user
  content. Any user-initiated support sharing is outside APP-OPS-01, is not established, and needs
  separate explicit Product authority.
- **(C)** No routine or exceptional human review of private QANDEEL conversation content is
  authorized through Company Operations or safety-monitoring flows.

The imported Company authority was checked and contains no conflicting human-review, moderation or
content-path assumption (index §7).

This change defines no moderation or replacement safety mechanism. It also leaves the QANDEEL App's
own authority untouched, including the App's CW2-08: bringing App-side documents in line is App
Product-track work outside this repository.

## D-PRE-C1-03 — Lifecycle and APP-OPS state corrected

The implementation map now reads:
- `L0` — CLOSED / PASS;
- `C0` — CLOSED / PASS;
- `C1` — NEXT — CLOUD MEGA-TASK.

PRE-C1 is recorded as preparation for Cloud execution, not as a Product / Architecture stage.

`APP-OPS-01` is described as a governed future boundary. On 2026-09-26 its App-side document
(`docs/p4/APP_OPS_01_COMPANY_OPERATIONS_CONTRACT_CANDIDATE.md`, merged to App `main` through
`allamqandeel/qandeel#278`) carries the status `PRODUCT / ARCHITECTURE CONTRACT CANDIDATE — NOT
FROZEN`. There is no Company-side integration.

## D-PRE-C1-04 — Verifier extended, stage-aware

`scripts/verify-bootstrap.mjs` gains four rules:
- `authority-import-integrity`. Every manifest row resolves to a file, and every hash matches. Each
  row is an `exact` copy whose source and imported SHA-256 are equal. No
  imported row is `SUPERSEDED` or `UNKNOWN`, and every file in the directory is listed. Only Markdown
  is allowed. The Stage 16 "not found" statement must remain until a Stage 16 source is imported
  with a manifest row.
- `no-archive-dumps`. No archives anywhere, and nothing but Markdown under `docs/authority/`.
- `privacy-hard-boundaries`. The baseline carries Rules A–C, and the active summary documents do
  not carry the old wording that allowed a default with an unspecified exception.
- `implementation-lifecycle-state`. `L0` and `C0` are `CLOSED / PASS`, `C0` is not the current task,
  and `C1` may not be marked closed or implemented unless a `docs/C1_*CLOSURE*.md` record exists.

The package allowlist (`ALLOWED_PACKAGES`) is already stage-aware: the change that adds a real
package extends it. It is kept, so PRE-C1 cannot add a package and C1 is not blocked.

Imported sources keep their Markdown hard line breaks and their exact bytes. For the imported source
directories only, `.gitattributes` turns off Git's whitespace checks and line-ending normalization
(`-text -whitespace`).

## D-C1-01 — C1 package shape

Three real packages, dependency order `domain → storage → runtime`:
- **`domain`** holds pure contracts: IDs, clock, state machines, retry, the processor contract and
  the event envelope. It has no I/O.
- **`storage`** holds the workspace, the SQLite adapter, migrations, repositories, the Artifact Store
  and backup.
- **`runtime`** holds the supervisor, dispatcher, recovery, wake, health and CLI.

`bootstrap-contract` is kept unchanged as the C0 toolchain record. No package was created for a later
subsystem. `ALLOWED_PACKAGES` was extended in the same change.

## D-C1-02 — Node floor raised to 24.12.0

C1 sets `defensive: true` explicitly on every connection. That constructor option and
`enableDefensive()` were added in Node **v24.12.0**; defensive mode became the default in v24.14.0.
The `engines` floor is therefore `>=24.12.0 <25.0.0` in the root and in every C1 package. The Founder
host runs 24.19.0, and CI and Cloud run 24.21.0. The other `node:sqlite` APIs C1 uses are all older:
- the `timeout` option (v24.0.0);
- `isTransaction` (v24.0.0);
- `backup()` (v23.8.0);
- `allowExtension` / `enableForeignKeyConstraints`.

## D-C1-03 — `node:sqlite` behind one adapter

`node:sqlite` is a **Release Candidate** API (Stability 1.2 since v24.15.0). Its `DatabaseSync`
operations are synchronous.
- **One importer.** `packages/storage/src/sqlite/connection.ts` is the only module that imports it,
  enforced three ways:
  - the ESLint `no-restricted-imports` rule;
  - the verifier rule `sqlite-confined-to-storage`;
  - the `exports` map, which forbids deep imports.
- **No SQL leaves storage.** The storage entry point exports Company operations only: no connection,
  no `storeContext` and no "execute SQL" method. The verifier's `workspace-resolution` step checks
  this at run time.
- **No third-party SQLite library** was added.

## D-C1-04 — SQLite durability and locking settings

The settings:
- `journal_mode=WAL`, read back as `wal`;
- `synchronous=FULL`;
- foreign keys on;
- defensive on, proven by probe: `writable_schema` cannot be switched on;
- `allowExtension:false`, which cannot be re-enabled later;
- `enableDoubleQuotedStringLiterals:false`;
- `trusted_schema` off;
- a bounded busy timeout: 5 s by default, 0–60 s allowed.

Rationale:
- **`synchronous=FULL`.** In WAL mode, `NORMAL` keeps the database consistent, but the most recently
  committed transactions can roll back after a power loss or OS crash. `FULL` syncs the WAL on every
  commit, so a transaction the runtime has relied on stays durable. Strong v1 prefers durability over
  write throughput.
- **`wal_autocheckpoint` stays at the SQLite default** (1000 pages): C1 produced no evidence against it.
- **Write transactions are `BEGIN IMMEDIATE`**, which takes the write lock up front. A claimant
  therefore never upgrades from a read snapshot into a busy error mid-transaction. Contention fails
  within the busy timeout (`STORAGE_BUSY`) rather than hanging.
- **No lock-free or exactly-once claim.** WAL still admits one writer at a time, and nothing claims
  otherwise.

## D-C1-05 — Official-source refresh (2026-09-26) and one Cloud gap

**Node.** Read `https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.md` (v24.21.0) on
2026-09-26. Confirmed:
- the module status is Release Candidate;
- `DatabaseSync` is synchronous;
- foreign keys, `allowExtension` (default false), `defensive` (v24.12.0), `timeout` (v24.0.0);
- `backup()` wraps `sqlite3_backup_*`. Mutations from another connection restart a paged backup;
  mutations from the same connection are included.

**SQLite.** `sqlite.org` (`wal.html`, `lang_transaction.html`, `backup.html`, `pragma.html`) was
**denied by the Cloud session's network egress policy**. The fallbacks were:
- SQLite's own API text in `sqlite3.h` 3.53.4, vendored in Node v24.21.0
  (`deps/sqlite/sqlite3.h`), for the online backup restart semantics, `SQLITE_DBCONFIG_DEFENSIVE` and
  the busy handler;
- empirical probes on the bundled SQLite 3.53.4: WAL readers see committed state during a write
  transaction, busy failure at the timeout, the defensive probe, extension refusal, backup plus a
  rollback-journal snapshot.

The WAL same-host / no-network-filesystem rule, `BEGIN IMMEDIATE` semantics, `synchronous` behaviour
in WAL and the checkpoint default are recorded from prior knowledge of those pages. They were **not
re-fetched**, and they match the task's stated facts. **Founder-host follow-up:** re-read the four
`sqlite.org` pages and confirm D-C1-04. No hard incompatibility with the approved baseline was found.

## D-C1-06 — One persisted time format

Timestamps are fixed-width ISO-8601 UTC with milliseconds, and a `GLOB` `CHECK` enforces it. Text
order equals time order, so leases and due times compare as `TEXT`. Tests use an injected
`ManualClock`, and lease/backoff unit tests never sleep.

## D-C1-07 — Fail-closed approval gate

Stage 1 §1 says sensitive actions fail closed when the approval path cannot decide, and Stage 3 §3
says R3 requires Founder approval. Work with `approvalRequired`, or at risk R3 or R4, is therefore
stored in `WAITING_APPROVAL` and can never be released for execution in C1
(`APPROVAL_PATH_UNAVAILABLE`). This invents no approval mechanism: C2 owns the approval engine.

## D-C1-08 — Cancellation race rule

> **Superseded by D-C1-20** (Product Owner approved, C1 canonical). Kept as the historical record.

Durable termination intent (cancel or supersede) recorded **before** a run settles always wins. The
settlement finalizes it, even when the processor reported `COMPLETED`. Completion committed first
makes a later cancellation fail deterministically (`INVALID_TRANSITION`); supersession is still
allowed. A terminal-row trigger forbids resurrection.

## D-C1-09 — When a dependency is satisfied

> **Superseded by D-C1-17 (amendment) and then D-C1-21** (Product Owner approved, C1 canonical).
> The rule below (satisfied at `COMPLETED` for all work) is historical only.

A dependency is satisfied when the dependency enters the completed family (`COMPLETED` or later).
Stage 8 defines no stricter rule. A later policy (C4) may require review first; this choice lives in
one constant (`DEPENDENCY_SATISFIED_STATES`). Dependencies that end as `FAILED`, `CANCELLED` or
`SUPERSEDED` leave dependents `BLOCKED (DEPENDENCY_FAILED)`. They are not auto-cancelled: escalation
policy is C4's.

## D-C1-10 — Attempt accounting

A retryable failure and an **interrupted** attempt (crash or lease loss) both count toward
`maxAttempts`, which bounds crash loops (Stage 15 D15-C.6). Waiting and a graceful shutdown park do
not count. Backoff is deterministic, with no jitter, so tests and recovery are reproducible.

## D-C1-11 — Cross-process wake without a network or IPC service

> **Amended by D-C1-23.** The wake file is only the low-latency hint; a lost hint is now recovered
> within one supervisor heartbeat through the durable wake generation.

Another local process that commits work (for example the CLI) writes `<workspace>/runtime/wake.signal`.
The runtime observes it with `fs.watch`, which is OS change notification, not polling. A lost hint
never loses work, because the queue is durable, but it can delay pickup until the next pump or a
restart. The watcher is therefore re-armed once on error and otherwise reported by health
(`WAKE_WATCHER_UNAVAILABLE` → `DEGRADED`). No HTTP server,
socket or named pipe was added. The Founder UI IPC (Stage 12 §47–§50) belongs to a later package.

## D-C1-12 — Backup mechanics

`backup()` runs from a dedicated connection with a very large page batch, so the copy is one step. A
paged backup would restart whenever another connection writes (sqlite3.h), and a busy writer could
then starve it. The snapshot is then switched to the rollback journal (`journal_mode=DELETE`) so it is
one self-contained file, followed by the full `integrity_check` and `foreign_key_check` and a manifest
with SHA-256. Verification opens the snapshot read-only and never touches the live file. Restore goes
only to a new, empty workspace, with a dry start. No backup uses `tar`, and none copies the active
database file.

## D-C1-13 — Local-filesystem enforcement limits

Rejected everywhere: relative paths, UNC paths, device-namespace paths and symlinked workspace
directories. On Linux, network mounts are also rejected (`/proc/self/mountinfo`). Windows mapped
network drives cannot be detected without native code (Smart App Control forbids native addons) and
are **documented as unsupported** for the canonical WAL database.

## D-C1-14 — Verifier evolution

New rules, each with negative self-tests and, where brittleness is possible, must-pass future states:
- `sqlite-confined-to-storage`;
- `no-network-in-runtime-code`;
- `runtime-dependencies-allowlisted`: only `@qandeel-company/*` unless a reviewed exception is
  listed;
- `migrations-immutable`: every migration file pinned by SHA-256, with CRLF tolerated;
- `c1-proof-tests-present`: the non-vacuity contract.

Changed rules:
- `implementation-lifecycle-state`:
  - C1 may read "… — NOT CLOSED" without a closure record;
  - "CLOSED" without the record still fails;
  - C2 may start only after a C1 closure record exists;
  - the C1 report may not claim closure.
- `workspace-tests-present` accepts the stricter runner.
- `no-placeholder-packages` also rejects a C2-style package that was not approved.

A future package is added by extending `ALLOWED_PACKAGES` in its own change. Every guard from C0 and
PRE-C1 is kept.

## D-C1-15 — Test runner refuses vacuous passes

`scripts/run-node-tests.mjs`:
- runs exactly the tracked `test/**/*.test.ts` files, compiled;
- fails if a compiled file is missing;
- fails if fewer tests ran than there are files;
- fails on any failure, and on any skipped, todo or cancelled test.

Concurrency is 1, for deterministic multi-process timing. Multi-process and fault tests use child
processes of the same signed `node` with argument arrays (no shell). On Windows, SIGKILL maps to
TerminateProcess, so the same fault matrix runs on both CI operating systems.

## D-C1-16 — Branch

The Cloud platform mandated the branch `claude/dreamy-wozniak-nq3hr8`, and it was used instead of the
preferred `feat/c1-company-foundation-durable-runtime`, as the task allows.

## D-C1-17 — Internal review dispositions (fail-closed review, truthful runs, bindings)

The internal review lenses A and C drove these changes:
- **ACHIEVED only through OUTCOME_VERIFIED.** Closing can no longer record success (Stage 8 §34). This
  is enforced in the domain and by a database trigger.
- **No faked approval.** `WAITING_APPROVAL` is no longer a manual target, and in C1 it can be exited
  only by cancellation or supersession.
- **Review required at R2+ (Stage 3 §2/§4).** `REVIEWED` and `OUTCOME_VERIFIED` fail closed in C1
  (`REVIEW_PATH_UNAVAILABLE`), because review independence must be enforced by authority and none
  exists before the permission engine and Review Pool (C2/C4). This extends D-C1-07's fail-closed rule
  from approval to review. It narrows what C1 can do and adds no Product behaviour.
- **D-C1-08, amended.** A run that genuinely completed after termination was requested is recorded
  `SUCCEEDED`, with its evidence. The Work Item still honours the earlier intent. Side-effecting
  processors (`IDEMPOTENT`/`UNSAFE`) go to reconciliation instead of a silent choice.
- **D-C1-09, amended.** Review-required work satisfies dependents only once `REVIEWED`; other work,
  once `COMPLETED`.
- **Workspaces inside a Git working tree are refused** by the product itself, not only by the
  acceptance harness.
- **No caller-supplied migrations.** `CompanyStore.open` accepts only the released, pinned migrations.
  The fixture seam is a storage-internal, test-only function.
- **Backup verification is bound to the live Company.** It checks the `backup_records` hashes and
  requires the snapshot schema to equal the released schema of its version.
- **Artifact promotion hashes content before taking the write lock.**
- **Restore targets are validated before first touch** and must lie outside the live workspace.

**Product decisions (historical note, now closed):** at the time of this review, D-C1-08 and
D-C1-09 were open Product questions. The Product Owner has since **approved** both rules; see
D-C1-20 and D-C1-21. Nothing about them remains open.

## D-C1-18 — Internal review dispositions (lens B: durability, concurrency, failure)

- **Free-loop defects.** A processor that stops unprompted, or waits until the past, is a bounded
  failure (`PROCESSOR_STOPPED_UNPROMPTED`, `INVALID_WAIT`). Storage refuses a malformed or past
  `WAIT.until`.
- **Busy settle.** Settle retries `STORAGE_BUSY` with bounded backoff while the lease keeps renewing,
  so completed work is never re-executed because of contention.
- **Supervisor renewal is token-conditional.** A host sleep past the TTL without a takeover keeps
  authority, and the renewal is audited. A real takeover fail-stops loudly: `onFailStop`, and the CLI
  exits 1.
- **Concurrent first open.**
  - The migrator reads `user_version` and `schema_migrations` in one snapshot, re-checks inside
    each `BEGIN IMMEDIATE`, and skips what another process already applied.
  - The switch to WAL retries busy within the busy bound.
  - The test is multi-process: four opening processes, each migration applied once.
- **Fenced artifacts.** Artifact staging and promotion verify the worker's fence inside their own
  transactions.
- **Durable audits of rejections.** A refused supervisor acquisition is audited in a separate
  transaction.
- **Backup durability.** Snapshot and manifest files, and the directory on POSIX, are fsynced before
  `backup_records` commits `ok`.
- **Windows renames.** Artifact publish and quarantine retry transient `EPERM`/`EBUSY`/`EACCES`.
- **Artifact recovery.** Recovery never deletes a temp file whose row is still `STAGED`, and it
  audits an orphan before moving it.
- **Non-vacuity tests** now isolate each fence check: expired lease without a reclaim, an old token
  with the right run and owner, and a stale artifact attachment.
- **Residual, documented.** `CompanyStore.claimNext` without a supervisor fence remains available to
  storage-level callers. The runtime always passes the fence, and startup recovery would reclaim
  unfenced claims.

## D-C1-19 — Final disposition verification and residual fixes

An independent verifier re-checked every lens A/B/C disposition at `300c2d5` and confirmed them fixed.
Its mutation checks show that removing the token check, the expiry check or the in-transaction
artifact fence each fails a test. Its residual findings were handled as follows:
- **Reopening released work.** Work whose dependents already proceeded can no longer be reopened
  through an optional review; follow-up work is opened instead.
- **Replacement that depends on the old work.** It is refused (`DEPENDENCY_CYCLE`), because that
  dependency could never resolve.
- **Artifact fencing.** A run-linked artifact must present that run's fence. A stale attachment is
  audited, and its staging file is removed.
- **Refused Git-tree opens.** The check now runs before any directory is created, so a refused open
  creates nothing.
- **Acceptance backups.** The acceptance harness verifies and restores backups bound to the live
  `backup_records`.
- **Documented, not changed:**
  - The library-level `verifyBackup` / `restoreToIsolatedWorkspace` keep `expected` and
    `liveDatabasePath` optional (verifying a copied backup elsewhere is legitimate). The CLI and
    runtime always bind them.
  - `notifyRuntime` has a check-then-write window. The wake file is only a hint and carries no data.
  - The `backups/` parent directory entry is not fsynced separately.
- **Migration 0001 was revised in place, before C1 was ever merged or used on a real workspace.** It
  gained `max_attempts` and the no-resurrection and success-needs-verification triggers, and its pin
  was updated. From the first merge on, released migrations are immutable: a change is a new
  numbered file (verifier rule `migrations-immutable`). A workspace created from an unmerged
  intermediate commit is disposable test state.

## D-C1-20 — Product Owner closure: cancellation vs completion (D-C1-08)

**Status: PRODUCT OWNER APPROVED / C1 CANONICAL** (2026-09-27, C1 final remediation). It supersedes
the open status of D-C1-08.

**Rule.** Durable ordering governs the Work Item state, while factual Run history stays truthful.
First durable canonical ordering governs future state; factual history is never falsified.
- **Termination intent committed first** (cancel or supersede, before completion settles):
  - The Work Item honours it and cannot be resurrected (the terminal-row trigger forbids it).
  - A run that genuinely finished is recorded as `SUCCEEDED` with its evidence (failure code
    `TERMINATION_REQUESTED`). The Work Item gets no `COMPLETED` transition.
- **Ambiguous external effect** (`IDEMPOTENT`/`UNSAFE` class, or a crash of `UNSAFE` work):
  - Cancel or complete is never chosen silently. The job enters `RECONCILIATION_HOLD` and the item
    `BLOCKED (RECONCILIATION_REQUIRED)`, with the run evidence preserved.
  - An explicit reconciliation decision then resolves it. The termination was durably first, so
    the Work Item honours it on **every** decision.
  - The decision itself stays on record. `CONFIRMED_COMPLETED` is audited, and it leaves the job
    `DONE` because its work did happen.
- **Completion committed first:** a later cancellation is refused (`INVALID_TRANSITION`) and
  rewrites nothing. Supersession of completed work remains a separate, legitimate later event.
- **No timestamp priority:** there is no rule outside durable commit order.

**Job state vs run truth.** When a `NONE`-class run finishes after termination was requested, its
job ends `CANCELLED` and its run `SUCCEEDED`. Nothing external happened, and the job's outcome is
the termination. When reconciliation **confirms an external effect** under termination intent, the
job ends `DONE`, because the effect is a fact in the world that must stay visible. In both cases the
Work Item honours the termination.

**Code alignment.** One path was changed. `resolveReconciliation(CONFIRMED_COMPLETED | FAILED)`
previously let the decision override an earlier termination intent (`COMPLETED` or `FAILED`). It now
honours the intent, as the approved rule requires. Tests:
`packages/storage/test/product-decisions.test.ts` (marker `C1-PROOF: product-decisions-d-c1-08-09`).

## D-C1-21 — Product Owner closure: dependency satisfaction (D-C1-09)

**Status: PRODUCT OWNER APPROVED / C1 CANONICAL** (2026-09-27). It supersedes the open status of
D-C1-09.

**Rule.** Completed ≠ Reviewed.
- **Work that does not require review** satisfies its dependents at `COMPLETED`, or at any later
  state in the completed family.
- **Work that requires review** satisfies them only at `REVIEWED` or later (`OUTCOME_VERIFIED`,
  `CLOSED`). This includes work whose risk policy makes review mandatory (R2+).
- **Failure family:** `FAILED`, `CANCELLED` and `SUPERSEDED` never release dependents. They stay
  `BLOCKED (DEPENDENCY_FAILED)`.
- **Not added:** a per-dependency `OUTCOME_VERIFIED` gating mode. `OUTCOME_VERIFIED` remains a
  distinct canonical state.

**Code.** It already matched the rule (`satisfiesDependents`, one predicate), so only the comments
changed. C1 still cannot reach `REVIEWED` through any public path (`REVIEW_PATH_UNAVAILABLE`, the
fail-closed review gate). The regression test therefore commits `REVIEWED` through the internal
transition primitive, as the future C2 review authority will, and shows that the dependent is
released in that same transaction.

## D-C1-22 — Runtime Supervisor claim authority enforced structurally (finding F1)

**Finding.** Three things together meant that later Company code could claim or drive work outside
the Runtime Supervisor:
- `ClaimOptions.supervisor` was optional;
- `CompanyStore.claimNext` and `claimJob` were on the ordinary API;
- `CompanyRuntime.store` returned the mutable store.

**Decision.**
- **Mandatory fence:** `ClaimOptions.supervisor: SupervisorFence` is required.
  - `verifySupervisor` runs unconditionally inside every claim transaction (`claimNext`,
    `claimJob`).
  - It rejects a missing or malformed fence (untyped callers) as well as a wrong holder, wrong
    token, expired lease or replaced supervisor (`SUPERVISOR_NOT_AUTHORITATIVE`).
  - Recovery writes that take a claim away (`interruptClaim`, `interruptOrphanRun`,
    `settleDanglingTermination`, `abandonStaleInstances`) also verify the supervisor fence.
- **Authority behind one subpath:** claims, the supervisor lease, worker writes (`renewLease`,
  `checkpoint`, `settle`) and instance bookkeeping moved off `CompanyStore`. They now live in
  `@qandeel-company/storage/runtime-authority`.
  - The ordinary `@qandeel-company/storage` entry point exposes none of them.
  - The exports map admits exactly `.` and `./runtime-authority`; every deep import is refused.
- **Only the runtime:** only `packages/runtime` may import that subpath. This is enforced by:
  - ESLint `no-restricted-syntax`;
  - verifier rules `runtime-authority-confined`, `supervisor-claim-fence-mandatory` and
    `no-runtime-store-escape`, each with negative self-tests and legitimate must-pass states;
  - the live resolution check in `workspace-resolution`.
- **No mutable store escape:** `CompanyRuntime.store` was removed. Callers get `runtime.view`, a
  frozen `CompanyReadView` that holds bound read methods only and has no path back to the store.
  Health uses the same view.
- **Tests:**
  - Storage tests acquire a real supervisor lease (the harness), and no unfenced test seam exists.
  - Multi-process fixtures present the parent's real fence.
  - The claim race now includes processes that present a stale supervisor token; they never win.
- **Proofs:**
  - `packages/storage/test/supervisor-authority.test.ts` (marker
    `C1-PROOF: supervisor-claim-authority`);
  - the `runtime.test.ts` "no mutable store escape" test;
  - `scripts/c1-mutation-check.mjs`, which removes the claim and recovery supervisor verification
    and requires the proofs to fail. It runs in `npm run ci`.
- **Unchanged:** worker (job) fencing is still an independent guard.
- **Hardened after focused review R1** (MAJOR): the lease's holder and token are publicly readable
  (health), so a fence rebuilt from them could have driven recovery writes through the then-public
  `runRecovery`.
  - Fences are now **unforgeable**. Only a frozen fence object issued by `acquireSupervisor` in
    this process is accepted (a module-private registry, checked before the database check).
  - `runRecovery` is no longer exported.
  - `runtime.artifacts` is a frozen read-only view, with no `put`, `recover` or `verifyAll`.
  - ESLint also refuses re-exports of the subpath and `createRequire`, and the verifier refuses
    `createRequire` in package sources and checks that `runRecovery` stays unexported.
  - Storage multi-process fixtures adopt their parent's fence through a storage-internal test-only
    function, which neither entry point exports. It refuses to run outside the Node test runner
    (`NODE_TEST_CONTEXT`); this was added as defence in depth after R1's re-verification.

## D-C1-23 — Bounded lost-wake reconciliation (finding F2)

**Finding.** `fs.watch` was the only cross-process wake. If its notification was lost, an idle
`READY` runtime could leave committed runnable work undiscovered indefinitely.

**Research** (Node 24 official docs, read 2026-09-26):
- `fs.watch` "is not 100% consistent across platforms, and is unavailable on some systems".
- It can be "unreliable, and in some cases impossible" on network file systems and in containers.
- Its `filename` argument is "not always guaranteed".
- Timers carry "no guarantees about the exact timing".

So `fs.watch` cannot be the sole correctness mechanism.

**Decision.**
- **Event-driven first; no new loop.**
  - Migration `0003_runtime_wake_generation` (new file; 0001 and 0002 untouched) adds a single-row,
    monotonic `runtime_wake.generation`.
  - Triggers advance it **in the same transaction** as every queue change that can make work
    actionable: a job inserted `QUEUED`, a job becoming `QUEUED` or its due time moving, or
    `cancel_requested` changing. This holds whichever process or code path commits it.
- **Fast path unchanged:** the in-process `WakeSignal` and the `fs.watch` wake-file hint.
- **Reconciliation on the existing heartbeat:**
  - The existing Supervisor heartbeat reads the generation in its renewal transaction. If renewal
    is busy, it reads it through a non-blocking WAL read.
  - Every pump records the generation it started from, read before scanning.
  - If the heartbeat sees a different generation, it signals one coalesced pump. Otherwise it does
    nothing: no scan, no claim, no model call.
- **Bound:** a missed hint is discovered within **one heartbeat interval** = `max(100 ms,
  supervisorTtlMs / 3)`.
  - That is **10 s at the default 30 s TTL**, plus timer scheduling slack.
  - It applies while the runtime has a free worker slot. At capacity, the next slot release pumps
    anyway.
  - Under writer contention (review R2), one beat can wait up to the busy timeout (5 s by default)
    before falling back to a non-blocking WAL read. A beat that still cannot read is counted
    (`heartbeatsSkipped`) and adds one interval.
  - Repeated pump errors back off exponentially (250 ms → 30 s) instead of retrying at a fixed rate.
  - It is an infrastructure bound, not a Product SLA.
- **Health:** a failed watcher stays visible (`WAKE_WATCHER_UNAVAILABLE` → `DEGRADED`). Discovery
  then runs at heartbeat latency.
- **Proof:** `packages/runtime/test/integration/lost-wake.test.ts` (marker
  `C1-PROOF: lost-wake-reconciliation`).
  - A real second OS process commits the work and writes the wake file.
  - The runtime's active watcher delivers the notification, and it is deliberately dropped.
  - No `wake()` or `pump()` is called and no other job or timer exists.
  - The work is claimed within 500 ms + 1.5 s margin (TTL 1.5 s), and the idle runtime then shows
    zero pumps and zero claims, with a bounded number of statements per heartbeat.
  - The same holds with no watcher at all, and for a cross-process cancellation of running work.
  - The mutation check removes the reconciliation (the `d57b51f` behaviour) and requires the proof
    to fail.

## D-C1-24 — Backup finalization under write contention (Founder-host failure on `71f2edf`)

**Evidence.** Founder-host local acceptance of exact SHA `71f2edf` ran the storage multi-process
suite three times: it passed twice and failed once, after about 5.8 s, in
`online backup while another process writes continuously: every snapshot verifies and is
transactionally consistent`, with
`STORAGE_BUSY: database lock not acquired within the busy timeout during record backup`.
Exact-head GitHub CI (Windows and Ubuntu) did not expose it.

**Root cause (concurrency, not "Windows only").**
- `createBackup` produced the snapshot, verified it, wrote and fsynced the manifest, and then ran
  one final `BEGIN IMMEDIATE` to insert the `backup_records` row.
- Against a process that writes continuously, the write lock is free only in the short gaps
  between that process's transactions. SQLite's busy handler polls with growing sleeps, so one
  acquisition can miss every gap until its busy timeout (5 s) expires. The other writer's pace and
  the host's scheduling decide how often that happens.
- Measured in the Cloud container against the real writer fixture: p50 21 ms, p90 534 ms, p99
  1.8 s per acquisition at a 5 s timeout, and 10% of acquisitions failing at a 250 ms timeout.
- The function then threw after the files existed. `listBackups(backupsDir)` enumerated
  UUID-named directories with a manifest, so the unrecorded attempt was listed as a backup.
  Reproduced deterministically at `71f2edf`: the exact Founder-host message, and 2 listed
  backups for 1 recorded.

**Official sources (2026-09-27).**
- Node 24 `node:sqlite` (read): `timeout` is "the maximum amount of time that SQLite will wait for
  a database lock to be released before returning an error".
- `sqlite.org/rescode.html`, `backup.html` and `c3ref/backup_finish.html` are blocked by the Cloud
  egress proxy (HTTP 403, and the fetch tool reports `EGRESS_BLOCKED`). They were **not read in this
  pass**. The design relies only on the cited facts (BUSY at `BEGIN IMMEDIATE` when another
  connection owns the write lock; after a successful `BEGIN IMMEDIATE` no later statement of that
  transaction returns BUSY; BUSY/LOCKED are retryable in the backup API). The runtime probe
  confirms them on Node 24.21.0 / SQLite 3.53.4:
  - `BEGIN IMMEDIATE` against a held lock → errcode 5 after the timeout;
  - a WAL reader keeps reading;
  - `COMMIT` after a successful `BEGIN IMMEDIATE` with a concurrent reader succeeds.
- The Founder-host re-read of these pages (D-C1-05) remains required.

**Decision.**
- **Snapshot unchanged.** Online Backup API on a dedicated connection, isolated
  `integrity_check` and `foreign_key_check`, manifest, hash binding, fsync before record. The
  snapshot is never redone on BUSY.
- **Bounded retry of the record transaction only** (`finalizeBackupRecord`):
  - only `STORAGE_BUSY` (SQLITE_BUSY/SQLITE_LOCKED at write-lock acquisition) is retried; every
    other error, including a conflicting record, fails immediately;
  - each attempt is a fresh short `BEGIN IMMEDIATE`, bounded by the store's **unchanged** busy
    timeout (`DEFAULT_BUSY_TIMEOUT_MS` = 5 s);
  - between attempts, control is released completely and a delay is awaited outside any
    transaction: `min(1000, 100 × 2^(n−1))` ms, jittered to [0.5, 1] of that;
  - **default 4 attempts**: worst case `maxAttempts × store busy timeout + delays` = 4 × 5 s +
    ≤ 0.7 s ≈ 21 s at the defaults (a store opened with a longer busy timeout scales it), then `STORAGE_BUSY` "…within its
    bounded retry envelope" with `attempts`;
  - the policy is internal (tests inject delays); it is validated (1–10 attempts, delays ≤ 5 s)
    and not part of the public API.
- **No global busy-timeout inflation.**
- **Idempotent record** (`recordBackupOnce`):
  - no row → insert plus one `backup.created` audit row;
  - an identical row (ID, time, schema, both hashes, integrity, artifact count) →
    `ALREADY_RECORDED`, nothing written;
  - the same ID with any differing field → `STORAGE_INVARIANT`, the row is never modified (no
    `INSERT OR REPLACE`).
- **No canonical orphan.**
  - Any failure after the attempt directory is created removes **that attempt's own directory**:
    `<backups>/<backupId>` for an ID this call generated and created with a non-recursive `mkdir`,
    so an earlier backup is never touched.
  - If removal fails, the original error is kept (`attemptDiscarded: false`), not masked.
  - **Discovery is record-based:** `listBackups(store)` returns only IDs recorded in
    `backup_records` whose directory holds a manifest. The CLI `verify-backup`/`restore-check`
    already refuse an unrecorded backup; health `lastBackup` reads `backup_records`.
- **Crash window (documented, not eliminated).** If the process dies after the files are durable
  and before the record commits, or during cleanup, an unrecorded directory can remain on disk. It
  is never canonical: listing, verification-against-record, restore-check and health all ignore
  it. It is not swept automatically, because a sweep could race another process's in-flight
  backup. Retention/cleanup of such leftovers belongs with backup scheduling (C6).
- **No exactly-once claim.** A backup is recorded at most once per ID. A caller that sees a failure
  may run a new backup, which gets a new ID.
- **Proofs** (`packages/storage/test/backup-finalization.test.ts`, marker
  `C1-PROOF: backup-finalization-contention`):
  - BUSY on the first attempt, released during the retry delay, then recorded exactly once;
  - a lock held past the whole envelope, failing boundedly with nothing canonical left and the
    earlier backup byte-identical;
  - identical replay; conflicting same ID, by API and by a produced attempt;
  - cleanup failure; policy bounds; no retry of non-busy errors.
  - A cross-process variant against the locker fixture is in the multi-process suite.
  - The continuous-writer proof is kept at full pressure, and now also checks each backup against
    its live record and record-based listing.
  - Three new mutations in `npm run c1:mutation` (single attempt = the `71f2edf` behaviour; no
    cleanup; no idempotency) must each be caught.
- **Review follow-ups (R1/R2, no BLOCKER or MAJOR):** the cross-process test releases the lock only
  from the parent's retry delay; the helper validates its policy; `runtime.backup()` fails closed
  without a record; on POSIX the backups directory is fsynced after the new entry.
- **Founder-host re-validation of the new exact SHA is still required.**

## D-C2-01 — C2 package shape

**Decision.** C2 adds one new package, `@qandeel-company/governance`: the pure, deterministic C2
policy kernel with no I/O. It covers Employee lifecycle and identity validation, the R0–R4
authority decision, approval scope fingerprints, the reasoning (`E0..E4`) and data (`D0..D4`)
classes, the Router Policy, checked economics, the provider-adapter and tool-driver contracts,
the failure taxonomy and typed model proposals.
- **Persistence** stays in `@qandeel-company/storage`. `node:sqlite` stays in one adapter, and SQL
  stays storage-internal.
  - `GovernanceStore` covers Founder-authority administration and reads.
  - Fenced execution writes sit behind the existing `runtime-authority` subpath.
- **Execution** stays in `@qandeel-company/runtime`, under the Runtime Supervisor.
  - The governed Model Runtime is the only provider-adapter caller.
  - The Tool Executor is the only tool-driver caller.
  - `c2.employee-task` is the runtime-owned loop.
- `governance` is added to `ALLOWED_PACKAGES` in the same change. No third-party runtime
  dependency is added.

## D-C2-02 — Provider neutrality: no commercial provider in C2

**Decision.** C2 implements the complete provider-neutral adapter contract (`ProviderAdapter`), the
usage/cost normalization and the failure taxonomy, plus a deterministic fake provider and fake tool
drivers. **No real provider adapter is implemented**, so no provider API was researched and none is
claimed.
- CI makes no network call and no paid call.
- No credential exists anywhere.
- An adapter receives no credential through the request. A real adapter would obtain its
  credential privately from the host vault in its own constructor (D14-A.4, D14-D.5).
- Choosing and qualifying a real provider is a later decision with its own research.

## D-C2-03 — Migration 0004 and the approval binding on Work Items

**Decision.** All C2 state is in one new released migration,
`0004_c2_governance.sql`, pinned by SHA-256. Migrations 0001–0003 are unchanged and are now also
frozen by content in the verifier (`c1-migrations-frozen`), so editing one and re-pinning it is
refused.
- The C1 fail-closed approval gate gets its real authority path.
  `work_items.approval_id` (added by `ALTER TABLE`) binds a Work Item to the Founder-approved
  `work_item.execute` approval that released it.
- Defense in depth, three layers:
  - the domain `assertTransition` releases approval-gated work only with a bound approval;
  - trigger `work_items_approval_gate` refuses the release unless the bound approval is
    `APPROVED`/`CONSUMED`, decided by a `founder:` principal and scoped to this Work Item;
  - trigger `work_items_approval_gate_insert` refuses creating such work released.
- **R4 work is never released**, even with an approval: `FOUNDER_ONLY`.
- Without an approval, the C1 error code (`APPROVAL_PATH_UNAVAILABLE`) and C1 tests are unchanged.
- **C1 tests adapted, not weakened.** Four C1 tests hard-coded "current schema = 3" and now track
  the current version. The v2→v3 upgrade test pins its migration set to v3.

## D-C2-04 — Founder principal; Founder-only administration in Strong-v1 C2

**Decision.**
- **Principals** (`principals`) keep Human (Founder) identity ≠ Employee ≠ Runtime principal
  (D14-A.2). Exactly one active Founder principal (`founder:<uuid>`) can be registered.
- **Founder-only acts.** Grants, approvals (R3), budget creation and cap changes, qualification,
  egress approval, holds, activation and reconciliation are Founder authority in C2 (Stage 3 §3/§6).
- **Refusals.** An employee acting on its own subject is refused as `SELF_ESCALATION_REFUSED`; any
  other non-Founder is refused as `FOUNDER_ONLY`. Refusals are audited.
- **C4 owns delegation.** Director / manager delegation ("managers may allocate within an
  approved departmental budget") is not implemented.
- **Honest limit.** C2 records who the Founder is. Authenticating the human at a Founder surface
  (local IPC with caller identity, Stage 12 §48–49) is C5. Model output can never reach these
  entry points: no proposal type exists for them. **Superseded in part by D-C2-13:** a Founder
  reference is not authentication, so production C2 has no Founder write surface at all.

## D-C2-05 — Employee activation and execution eligibility

**Decision.**
- **Only `ACTIVE` executes.** `SHADOW`/`PROBATION` execution is Academy-controlled (C3) and is not
  granted here.
- **No activation before certification (D-C2-13).** Activation (`SHADOW` / `PROBATION → ACTIVE`)
  fails closed in C2: certification is C3's, and no Founder attestation or opaque reference
  substitutes for it. The CHECK that refuses an `ACTIVE` row without evidence references stays;
  only the test seam writes one, labelled `test-seam:<id>`.
- **Certificate kinds are reserved.** Review finding: `academy:`, `certification:` and `cert:`
  refs are refused, because only the C3 Academy may issue them.
- **Retirement** revokes grants and retires the employee principal. The Employee stays in history.
- **Lifting a suspension** goes through `RETRAINING`, never straight back to `ACTIVE`.
- **Names:** one Egyptian two-part human-style name per employee, distinct from every other
  employee's (`name_origin = 'EG'` is recorded, not inferred).
- **Surface to the Product Owner.** The transition table, including `RETRAINING → SHADOW/PROBATION`
  and `SUSPENDED → RETRAINING`, is an engineering reading of Stage 4 §8. The Product Owner may
  refine it.

## D-C2-06 — Budget accounting model

**Decision.**
- **Units.** Money is integer micro-units of one Company currency, set on the Company budget; price
  cards must use it. Tokens are integer quantities.
- **Ceilings.** Every amount is ≤ 10^15 micro-units (tokens ≤ 10^12), so sums stay exact in
  JavaScript numbers.
- **No SQL arithmetic.** SQLite turns an overflowing integer expression into a REAL (probed on
  3.53.4). All accounting sums are therefore computed with checked JS arithmetic and stored as
  integers.
- **The hierarchy is structural.** Each budget's parent is immutable. A child cap never exceeds
  its parent. `CHECK (reserved + spent ≤ cap + overrun)` guards every row.
- **Reservation is atomic across the chain.** One `BEGIN IMMEDIATE` transaction checks every level
  (Run → Work Item → Employee → Department → Company) and reserves at all of them, or at none.
- **Run budgets** are derived by the runtime at the first reservation of a run:
  `min(run cap or Work Item cap, Work Item cap)`.
- **Settlement.** Settlement charges the economic cost (≥ billed for METERED) and the tokens, and
  releases the whole reservation. **Overrun** (provider usage beyond enforced bounds) is recorded
  truthfully per level, flagged in usage and health, and never hidden.
- **Overhead.** Retry, fallback and escalation attempts are separate reservations with their own
  `attempt_kind`. They are bounded per run by the Router Policy's overhead ceiling, escalation depth
  and call ceiling.
- **Budget exhaustion** parks work (`WAIT BUDGET_EXHAUSTED`, token-free). A Founder cap increase
  wakes only the Work Items under that budget.

## D-C2-07 — Crash semantics of reservations and tool intents

**Decision.** For runs that are no longer `RUNNING`, recovery classifies what they left behind:
- A model-call reservation may already have been sent and billed. It becomes
  `RECONCILIATION_REQUIRED` and **stays reserved**. The Founder reconciles it: `CHARGE` the
  provider-reported usage, or `RELEASE`.
- A tool intent without a result:
  - `NONE` / `IDEMPOTENT` actions become `RETRYABLE` under the same idempotency key, and their
    reservation is released;
  - `UNSAFE` actions become `RECONCILIATION_REQUIRED` with the reservation held.
- **Idempotency keys** are derived by the runtime from the Work Item and the checkpointed step
  (`wi:<workItem>:s<step>`), never from model output. The planned tool request is checkpointed
  before its side effect, so a resumed run presents the same key and the same arguments.
- **Late but truthful writes.** Settlement and tool results are accepted from the same worker (same
  run and fencing token) even after lease expiry. Recording what really happened is history, not
  new authority. New reservations and intents require a live fence.

## D-C2-08 — Governed processor contract and containment

**Decision.**
- **Governed processors.** A `GovernedProcessor` receives `GovernedRunServices` (`invokeModel`,
  `executeTool`) bound to its claim's fence. It never receives the store, an adapter or a driver.
  The runtime binds the run to an eligible Employee (`run_attributions`) before calling it.
- **Side-effect class.** `c2.employee-task` declares `IDEMPOTENT`: external effects happen only
  through keyed tools, and tool-level reconciliation handles `UNSAFE` actions.
- **Automatic pause.** Three authority / bypass signals inside one run pause the Employee
  (`PAUSED`, `AUTO_PAUSE_AUTHORITY_DENIALS`, audited). This is deterministic containment (Stage 3
  §9, D14-E.5): it only reduces autonomy.
  - The signals are `NO_GRANT`, `FOUNDER_ONLY`, `EGRESS_DENIED` and `IDEMPOTENCY_CONFLICT`.
  - An unknown tool, invalid arguments or a Founder rejection are ordinary failures (review
    finding). They are audited as `tool.refused` and never counted.
- **R2 is not a violation.** An R2 request parks the work (`AWAITING_INDEPENDENT_REVIEW`) until the
  Review Pool exists (C4), and does not count as a denial.

## D-C2-09 — Events and audit for C2

**Decision.** The C1 `events.aggregate_type` CHECK fixes the aggregates. Changing it would mean
rebuilding a released table. C2 therefore:
- emits execution events on existing aggregates: `run.attributed`, `run.usage_settled` and
  `run.tool_invocation` on `run`; `work_item.approval_requested` and `work_item.approved` on
  `work_item`;
- records governance changes in dedicated append-only history tables (`employee_history`,
  `approval_history`, `budget_history`, `catalog_history`) plus content-free audit rows.

Audit rows, events and logs carry IDs, codes, amounts and argument **digests** only. Tool arguments
and results never enter them (Rule A).

## D-C2-10 — Official-source refresh (2026-09-27) and the Cloud gap

- **Node 24 `node:sqlite` documentation**, `nodejs.org/docs/latest-v24.x/api/sqlite.html`, reached
  and reviewed:
  - Stability 1.2 (release candidate);
  - `DatabaseSync` APIs are synchronous;
  - `readBigInts: false` → an out-of-safe-range INTEGER read throws `ERR_OUT_OF_RANGE`;
  - JS numbers bind as INTEGER or REAL.

  C2 keeps every stored amount ≤ 10^15, so no amount read can exceed the safe range.
- **`www.sqlite.org`** is blocked by the Cloud egress proxy, as in D-C1-05. The behaviour C2
  relies on was probed on the bundled SQLite 3.53.4 instead: integer overflow in arithmetic
  becomes REAL; STRICT refuses a non-integral REAL in an INTEGER column. C2 does not depend on
  either, because it does no SQL arithmetic.
- **Follow-up:** the Founder-host review repeats the sqlite.org check.
- **Toolchain:** the Cloud session used Node 24.21.0 (npm 11.19.0), checksum-verified from
  nodejs.org.

## D-C2-11 — Verifier and mutation evolution

**Decision.**
- **New verifier rules**, each with negative self-tests:
  - `model-calls-confined`;
  - `tool-drivers-confined`;
  - `budget-mutation-scoped`: budget, reservation and usage writes only in the storage governance
    modules; fenced signatures; nothing on the ordinary stores;
  - `no-plaintext-secrets`: secret literal formats; secret-shaped schema columns;
  - `c1-migrations-frozen`;
  - `no-later-scope-leakage`: C3–C7 tables and packages;
  - `c2-proofs-present`;
  - `c2-not-claimed-closed`: no C3 start before a C2 closure record.
- The synthetic self-test repository embeds the real frozen C1 migration texts.
- **`npm run c2:mutation`** removes 13 C2 gates from the compiled output. Its proof tests must fail
  for every one. It runs in `npm run ci`.
- **Known limitation:** the confinement rules are lexical (`.generate(` / `.invoke(`). Structural
  confinement comes from privacy: adapters and drivers are held in private fields of the two
  modules, and no API returns them.
- **CI:** the job timeout was raised to 50 minutes, and CI now runs the C2 acceptance on Windows
  and Ubuntu.

## D-C2-12 — Internal review round (four focused reviews at `4178d88`) and fixes

Four read-only reviewers ran at `4178d88`: authority / security; budget races / hidden spend;
model / tool boundary; scope leakage. Every in-scope BLOCKER and MAJOR was fixed on this branch.
Each item below is covered by a regression test, and new gates by a mutation.

**BLOCKER — processor-mutable run context (boundary review).** The shared run context could be
mutated, so a hostile governed processor could lower its data class (D4 → D1) and send D4 content
to an EXTERNAL provider.
- The context and cognitive profile are now deeply frozen.
- Model authorization and every reservation re-derive the effective data class, egress, locality,
  qualification, task class and the Employee's ceiling from durable state inside the transaction.
- Proofs: a hostile-processor runtime test; mutation `processor-can-widen-egress`.

**MAJOR — tool results could carry higher-class data to a model (security).** Each tool action
has a `result_data_class`. The effective context class is the maximum of the declared class and
the result classes of tool results already in the Work Item's context. It governs model egress
and later tool egress. Mutation `tool-result-does-not-raise-class`.

**MAJOR — an invalid data class became D1 (security + scope).** A missing class still defaults to
D1 (surfaced to the Product Owner). A class that is present but invalid now resolves to D4 in
storage and is refused by `c2.employee-task` (`INVALID_TASK_INPUT`) before any call.

**MAJOR — interrupted tool intents released money that may have been spent (budget).** A tool
call whose driver may have run is never released:
- after a crash, a timeout, a driver throw or a superseded dead intent, the fixed per-call cost is
  charged (`FAILED_CHARGED`), and NONE / IDEMPOTENT actions become RETRYABLE;
- UNSAFE actions become RECONCILIATION_REQUIRED with the reservation held;
- only an explicit driver `sent: 'NO'` releases the reservation.

**MAJOR — a retry superseded a live intent (budget).** An `INTENT_RECORDED` invocation whose run
is still RUNNING is never superseded (`IN_FLIGHT`). A dead run's intent is classified as recovery
classifies it before being reused. Recovery touches tool reservations only through their
invocation, so batching can no longer release an UNSAFE reservation.

**MAJOR — "academy:" refs looked like certification (scope).** Those refs are now reserved and
refused (D-C2-05).

**MAJOR — ordinary model mistakes paused Employees (scope).** Only authority / bypass signals
count toward the automatic pause (D-C2-08).

**MINOR fixes:**
- model authorization is re-run before every attempt, so a revoked grant or withdrawn egress
  applies to the next retry;
- model-written tool / action names never enter audit (Rule A);
- `recordDeploymentOutcome` requires the run's own fencing token;
- a cap cannot drop below a child's cap;
- a charge beyond its reservation is flagged as overrun per settlement;
- `accountingInvariants` also checks child ≤ parent caps, usage only on SETTLED reservations,
  succeeded invocations settled, reservations held on their own Run budget, and attribution
  consistency;
- reconciling a reservation that belongs to an uncertain tool invocation is refused (resolve the
  invocation instead);
- a late settlement after a Founder release is recorded as `budget.late_usage_discrepancy`;
- drivers receive the validated, frozen arguments bound to the intent / approval;
- the tool step is validated;
- context-overflow escalation happens at most once;
- external mutations must be R3 or R4 (the 0004 CHECK and the kernel);
- the Founder may decide a request they filed, but never one whose subject they are;
- a new ESLint AST rule confines `generate` / `invoke` in any syntactic form (dot, computed,
  destructuring) to the two modules.

**Mechanics.** The C1 mutation check now expects 5 occurrences of the recovery supervisor-fence
guard: the 4 C1 recovery writes plus the supervisor-fenced governed recovery. Migration 0004 was
not yet released or merged, so it was amended in place and re-pinned.

**Surfaced to the Product Owner rather than decided:** listed in `docs/C2_IMPLEMENTATION_REPORT.md`
§13.

## D-C2-13 — Founder-approved authority remediation (Founder decision)

**Context.** The Founder approved three corrections to the C2 candidate at `aea4d54`. They resolve
three items that §13 of the report had surfaced as Product interpretations.

**Decision.**
1. **A Founder reference is not authentication.** Until C5 provides the authenticated Founder
   surface:
   - production has no Founder write authority;
   - every Founder-authority write fails closed with `FOUNDER_SURFACE_UNAVAILABLE`, and is
     audited. This covers administration, grants, budgets, qualification, egress, holds,
     reconciliation, `registerFounder` and `decideApproval`;
   - the CLI offers no `register-founder`, `approve` or `reject` (read-only `governance` /
     `approvals` remain);
   - durable approvals and their enforcement stay: R3 stays `WAITING_APPROVAL` and R4 stays
     Founder-only.
2. **No Founder-attestation shortcut to `ACTIVE`.** Activation fails closed until the C3 Academy
   supplies real training / certification. C2 persists Employee identity and lifecycle, enforces
   execution eligibility and never fakes Academy evidence.
3. **D3 external egress stays closed.** Stage 14 makes D3 external authorization depend on a
   qualified conditional egress profile (account / endpoint / region / features / retention), not
   on the provider brand or a generic approval. C2 implements no such profile and invents no
   placeholder for it. The external ceiling is therefore D2 (`MAX_EXTERNAL_DATA_CLASS`), enforced
   in five places:
   - the router hard gate (before quality and cost);
   - the reserving transaction;
   - egress approval;
   - external tool registration and use;
   - migration 0004 triggers.

   D4 remains local-only, and D0–D2 go through the unchanged gates.

**Test-only seam.** Tests still need Founder-authority states and ACTIVE Employees, so a seam
(`packages/storage/src/testing/founder-seam.ts`) arms a workspace root in the current process and
activates an Employee. It is structurally test-only:
- it resolves only under the `qandeel-test` export condition (production resolution fails);
- it throws when loaded in a process started without that condition;
- it is not re-exported from the package index;
- the verifier confines its importers to tests and the C2 acceptance harness.

The seam's internals (`founderSurfaceInternals`) live in `governance.ts` because they need the
store's private field. Only the seam module may reference them, and the verifier rule
`founder-surface-test-only` enforces that.

**Consequence.** Until C5 and C3 exist, C2 production can inspect governance state but cannot
configure it or activate anyone: governed work fails closed. This is the intended fail-closed
posture, not a regression.

## D-C3-01 — C3 package shape

**Decision.** C3 adds one new package, `@qandeel-company/mind`: the pure, deterministic C3 kernel with
no I/O. It holds the Memory Write Policy, lexical retrieval and the context planner / renderer,
extractive compaction, the Skill pipeline rules (license classification, static inspection,
production eligibility, directive conflicts), capability evaluation and the Academy rules
(critical-dimension gating, diagnosis, probation criteria, certification gaps, time-aware status).
- **Persistence** stays in `@qandeel-company/storage`: `MemoryStore`, `SkillStore`, `AcademyStore`,
  `CapabilityStore` (Founder-authority administration, deterministic system steps and reads) and the
  fenced runtime writes (`assembleContext`, `submitMemoryCandidate`, `decideMemoryCandidate`,
  `decidePendingCandidates`) behind the existing `runtime-authority` subpath.
- **Execution** stays in `@qandeel-company/runtime`: the C3 Context Assembler
  (`src/c3/context-assembler.ts`), the memory-proposal path (`src/c3/memory-proposals.ts`), C3 health,
  read-only CLI commands and the `runtime.mind` capability object.
- `mind` is added to `ALLOWED_PACKAGES` in the same change. No third-party runtime dependency is
  added; no external vector database, embedding service or paid memory service is used.

## D-C3-02 — Migrations 0005 / 0006; 0001–0004 frozen

**Decision.** C3 adds `0005_c3_memory_context.sql` (canonical truth, memory candidates / records /
history / conflicts / corrections, lessons and promotions, knowledge, context manifests and entries,
compaction summaries, `budget_reservations.context_manifest_id`) and `0006_c3_skills_academy.sql`
(skills, versions, history, discoveries, updates, blueprints, passports, capability requirements /
gaps, Academy programs → certifications, activation requests, `run_execution_modes`). Both are pinned
by SHA-256 in `RELEASED_MIGRATIONS`. Migrations 0001–0004 are unchanged and the verifier freezes all
four by content (`released-migrations-frozen`).
- Every table is `STRICT` with bounded text / JSON `CHECK`s; history tables are append-only and
  undeletable; content columns are immutable and hash-pinned (`*_sha256`).
- `superseded_by_id` of canonical truth and knowledge is `DEFERRABLE INITIALLY DEFERRED`, so a
  supersession (old record superseded first, new record inserted) commits atomically without
  violating the one-active-claim unique index.
- Datastore defence in depth: `budget_reservations_model_call_manifest` refuses a `MODEL_CALL`
  reservation without an `OK` manifest of the same run whose input estimate it covers, and
  `employees_activation_gate` refuses SHADOW / PROBATION → ACTIVE without either the test-seam label
  or an APPROVED, Founder-decided activation request backed by a VALID same-role certification and a
  PASS probation review.

## D-C3-03 — Memory Write Policy: model output is only a candidate

**Decision.** A model's `MEMORY_CANDIDATE` / `OBSERVATION` proposal is submitted as a candidate
(transaction 1, fenced, idempotency key `wi:<workItem>:s<step>:memory`), then decided by the
runtime-owned policy (transaction 2). Recovery decides candidates left `SUBMITTED` by a crash.
- Provenance (`run:<id>`), evidence (`work_item:<id>`) and the data-class floor (the Work Item's
  effective context class) are set by the runtime, never by the model.
- Secrets are refused and their content is **not stored** (the candidate keeps a NULL content).
- Confidence is capped per class (CURRENT_WORK 80, EXPERIENCE 70, PROFESSIONAL 70,
  RELATIONSHIP_COLLABORATION 60) and at 40 without evidence; review horizons are 30 / 180 / 365 days.
- Exact and near duplicates (Jaccard ≥ 85 % of normalized terms, same owner / class / topic) are
  refused; a claim contradicting ACTIVE Canonical Truth is refused; a claim contradicting another
  memory opens a durable conflict (both kept, both held from context until resolved).
- Every load re-verifies the content hash; a mismatch marks the record CORRUPT, audits it and never
  uses it. Founder corrections are additive (the prior record is superseded, not rewritten).
- Values (caps, horizons, thresholds) are engineering defaults surfaced for Product Owner review.

## D-C3-04 — Knowledge scopes and access

**Decision.** Company Knowledge is scoped COMPANY / DEPARTMENT / ROLE / MARKET / RESTRICTED /
FOUNDER_ONLY and filtered **in SQL at retrieval time** (and re-checked in code).
- Own department, role and Work Item market are readable; another department needs an exact
  `knowledge.read` grant on `department:<id>` (each use is audited with the grant and counted);
  RESTRICTED needs an exact `knowledge.restricted` grant on the restricted scope; FOUNDER_ONLY is
  never readable by an Employee.
- Unauthorized items are not candidates at all, so they never appear in a manifest, summary or error.
- Knowledge is written only by Founder decision (`recordKnowledge`) or by an approved promotion of a
  validated lesson; model output never writes knowledge.

## D-C3-05 — Learning path and promotion

**Decision.** `EVENT → OBSERVATION → LESSON_CANDIDATE → review → VALIDATED → promotion`.
- A model `OBSERVATION` records an observation only. It becomes a lesson candidate only by a
  deliberate, attributed nomination (`nominateLesson`) — a mistake is not automatically a lesson. A
  model `PERSONAL_LESSON` candidate is recorded as observation + lesson candidate.
- The independent review path (Review Pool) is C4: `requestLessonReview` records that the lesson
  waits for it. In Strong v1 the Founder (authenticated surface, C5) validates; production therefore
  fails closed.
- PERSONAL promotion of a validated lesson becomes a PERSONAL_LESSON memory of the same Employee; every
  shared target (Role / Department / Market / Company / Restricted) stays `PENDING_REVIEW` until the
  review decides it. Nothing is shared by default.

## D-C3-06 — Mandatory governed Context Assembly

**Decision.** Every inference is fed by the C3 Context Assembler; nothing else can reach a provider.
- `ModelCallRequest` carries no messages (only step, recent results, task / reasoning class, output
  bound). The runtime assembles the step's context in one fenced transaction and hands the model
  runtime a frozen value minted in a module-private `WeakSet`; `GovernedModelRuntime.call` refuses any
  other value (`CONTEXT_NOT_ASSEMBLED`) before authorization, routing or reservation.
- Layers and precedence: L1 AUTHORITY (preamble, Canonical Truth) > L2 WORK (instructions, Academy
  scenario) > L3 SKILL (pinned, eligible, relevant) > L4 KNOWLEDGE > L5 MEMORY (own memory, compaction
  summaries) > L6 RECENT (the Work Item's durable step results, recorded by the runtime's own
  services — never processor-supplied text; only the newest is required). Canonical claims bind over
  every lower layer structurally, whether or not the canonical statement itself is relevant or loaded.
- Hard budget (default 24 000 tokens; frame reserve 512; layer shares 20 / 25 / 20 / 15 / 12 / 8 %;
  12 items per layer; per-Work-Item `contextBudgetTokens` 1 024..64 000). Required items that do not
  fit give `CONTEXT_BUDGET_EXHAUSTED`, never silent truncation.
- Retrieval is deterministic and lexical (Arabic-normalized terms, integer scoring over relevance,
  scope, freshness, confidence and authority; stable id tie-breaks). Pools are read through a term
  index (`mind_terms`: item kind, owner, term, item) joined with the task's query terms, bounded
  (memory 300, knowledge 200, canonical 200) and ordered by matched terms — never a scan of the full
  history. Canonical records whose claims a candidate asserts are always added. FTS5 and embeddings
  are not used.
- The stable prefix (L1 + L3) is rendered first; its SHA-256 is recorded. The manifest records
  selected / rejected item IDs, versions, hashes, classes, provenance and reason codes — never
  content — and is written even for refused assemblies.
- Every `MODEL_CALL` reservation names the step's OK manifest (store and datastore check it); a
  provider retry or fallback reuses the step's manifest.
- The effective data class of a Work Item includes every OK manifest's class, so context admitted at
  D3 binds routing, reservation and tool egress for the rest of the Work Item. Higher-class items are
  excluded unless the Work Item declares `contextDataClassCeiling` (minimization by exclusion).
- IMPORTANT work (declared, or R2+) on an unresolved memory conflict gets `CONFLICT_HOLD` (the loop
  waits `MEMORY_CONFLICT_REVIEW`); conflicting required skill directives give `SKILL_CONFLICT`; a
  corrupt ACTIVE canonical record gives `INTEGRITY_FAILURE`.

## D-C3-07 — Compaction summaries are derived, attributed and invalidated

**Decision.** A topic with more than four eligible memories is served by one extractive summary
(first sentences, bounded) recorded with its source IDs and a fingerprint of their id / version /
hash / status. Any source change invalidates it (`SOURCE_CHANGED`); a corrupt source is never
summarized. Summaries are never truth: they rank as memory, below knowledge and canonical truth.

## D-C3-08 — Skills: governed supply chain, pinned, never authority

**Decision.** `DISCOVERED → INSPECTED → LICENSE_DEPENDENCY_CHECKED → SECURITY_QUARANTINE → SANDBOXED →
BENCHMARKED → COMPARED → APPROVED` (or REJECTED with its reason kept).
- Inspection and the license / dependency check are deterministic system steps; every other step is
  Founder authority with evidence references (SANDBOXED requires a security pass).
- Licences: MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, CC0-1.0 are clear-free; the Unlicense (moved
  by Founder Decision D-C3-21) and licences with further obligations (CC-BY-4.0, copyleft, share-alike) wait at
  LICENSE_DEPENDENCY_CHECKED for a recorded licence review (`reviewLicense`: CLEAR with permission
  evidence → `CLEARED_BY_REVIEW`, or REJECT); unknown or missing is rejected; QANDEEL-native skills
  are QANDEEL-owned. The licence policy is an engineering default for Product Owner / legal review. A paid dependency makes the version `FREE_SKILL_PAID_DEPENDENCY`: approval waits for
  an explicit Founder acknowledgement. No paid Skill pack or marketplace exists.
- Production loads only a pinned version id through the one loader, and only when the version is
  eligible (approved, clear license, security-cleared, no findings, not on security hold / retired)
  and its hash verifies. DEPRECATED degrades (still loads, flagged); SECURITY_HOLD blocks at once.
- Skill ≠ Tool ≠ Authority: a skill's requested tools grant nothing; a tool grant never satisfies a
  skill requirement; governance / authority directives fail inspection.
- Updates: impact set (passports on the from-version), rollout repins, a material update requires
  recertification (certifications → REVIEW_DUE), rollback repins the previous eligible version.
  Discovery intake is deduplicated by source fingerprint.

## D-C3-09 — Capability requirements and durable gaps

**Decision.** Requirements (SKILL / CERTIFICATION / MARKET / TOOL) are declared on a PROPOSED Work Item
and only add gates. The gate runs inside the fenced run start, before any model or tool call; a gap is
a durable record that parks the work (`WAIT CAPABILITY_GAP`, zero tokens) and is never re-routed to
another Employee. Certification issuance and passport changes wake the parked work (durable wake
generation, no polling); the gap resolves when the gate next passes.

## D-C3-10 — Academy

**Decision.** Programs are versioned definitions bound to the role's ACTIVE blueprint.
- Path: LEARN → CASE_STUDIES → SIMULATION → FEEDBACK → (RETRY) → ASSESSMENT → SHADOW_WORK →
  PROBATION_REVIEW → CERTIFICATION → ACTIVATION_APPROVAL; BLOCKED on repeated critical failure.
  Stage advance is a deterministic system step that only reads recorded evidence.
- Attempts are real Work Items run by the runtime in constrained mode (below); one open attempt at a
  time; the scenario is served through the assembler and every exposure is recorded.
- Holdouts are never practice, and a holdout already exposed to the trainee never certifies.
- AUTHORITY_COMPLIANCE and COST_DISCIPLINE are scored only by the deterministic rubric from run facts
  (denials, spend vs scenario budget); the other dimensions by the evaluator — the Founder in Strong v1
  (the Review Pool is C4) — who is never the trainee. A critical-dimension failure fails the attempt
  whatever the average; failures are diagnosed into remediation categories and retraining.
- Certification pins the exact skill versions and proficiency, is role-specific, time-bounded, moves
  to REVIEW_DUE on material program / blueprint / skill change and can be revoked.

## D-C3-11 — The activation bridge stays fail-closed

**Decision.** Reaching CERTIFICATION files one activation request with its evidence (certification,
probation review, and the calibration if it is already approved). `decideActivation` is Founder
authority: it re-checks every piece of evidence — including, for a designated role, an APPROVED Founder
Calibration of the same enrollment (D-C3-19) — and only then sets ACTIVE with `academy:`, `probation:` and `activation:`
references. Until the authenticated Founder surface exists (C5) it fails closed in production
(`FOUNDER_SURFACE_UNAVAILABLE`). The C2 generic transition cannot carry an Academy reference, and
the datastore gate (D-C3-02) refuses any other path. The C2 test seam is unchanged and test-only.

## D-C3-12 — Constrained execution for trainees and Academy attempts

**Decision.** A TRAINING / SHADOW / PROBATION / RETRAINING Employee executes only its own open
Academy attempt (enrollment at an executing stage) or an assigned shadow Work Item; anything else is
refused at run start. An Academy attempt runs in `ACADEMY_ATTEMPT` mode whoever takes it (an ACTIVE
Employee recertifying included). In these modes no EXTERNAL-egress, external-mutating or R3 tool
action is allowed (`ACADEMY_CONSTRAINED`).

## D-C3-13 — Runtime integration

**Decision.**
- The `c2.employee-task` loop asks for a step; typed context outcomes map to WAIT
  (`MEMORY_CONFLICT_REVIEW`, `SKILL_CONFLICT_REVIEW`) or a permanent failure with the code.
- Memory proposals go through `services.proposeMemory` (submit, then decide); the loop learns only the
  decision code.
- A capability gap at run start becomes `WAIT CAPABILITY_GAP`.
- Recovery decides pending memory candidates (supervisor-fenced).
- Health gains a content-free `mind` component with reason codes (integrity / security / blocked /
  pending approvals need attention; conflicts / reviews degrade).
- Read-only CLI: `mind`, `capability-gaps`, `context-manifest --manifest <id>`; there is no C3 write
  command.
- `runtime.mind` exposes the C3 stores as a capability object that wakes the dispatcher after each
  call (like `governance`); Founder writes through it still fail closed in production.

## D-C3-14 — Verifier and mutation evolution

**Decision.** New verifier rules, each with violation and must-pass self-tests:
`context-assembly-mandatory`, `memory-writes-confined`, `skill-load-pinned`, `mind-kernel-pure`,
`mind-telemetry-content-free`, `activation-gate-present`, `c3-proofs-present`,
`c3-not-claimed-closed`; `c1-migrations-frozen` becomes `released-migrations-frozen` (0001–0004);
`no-later-scope-leakage` now forbids C4–C7 schema / packages only; `mind` joins `ALLOWED_PACKAGES`.
`scripts/c3-mutation-check.mjs` removes 39 C3 gates (30 at the candidate, 9 added by the Founder
decision closure, D-C3-22) from the compiled output and requires the proofs
to fail; it runs in `npm run ci`. `scripts/c3-acceptance.mjs` runs in CI on Windows and Ubuntu. The C1
mutation check now expects eight supervisor-verification guards (the C3 candidate recovery adds three:
list, decide, refuse — each its own supervisor-fenced transaction);
the C2 mutation search strings follow the C3 edits of the same gates.

## D-C3-15 — Official-source check (2026-09-27)

**Decision.** The Node.js `node:sqlite` documentation (nodejs.org, Stability 1.2 Release Candidate)
was re-read; C3 uses no new SQLite or `node:sqlite` feature beyond C1/C2 (STRICT, CHECK, triggers,
partial and unique indexes, `json_valid` / `json_each`, deferrable foreign keys). `sqlite.org` is not
reachable from the Cloud session (as in C1 / C2). FTS5 is compiled into the bundled SQLite 3.53.4 but
is deliberately not used: lexical retrieval is portable, deterministic and needs no FTS index
maintenance; a better retriever can replace it later without changing Memory identity or provenance.

## D-C3-16 — Internal review round (five focused reviews) and fixes

**Context.** Five read-only reviews ran on the candidate (memory / knowledge conformance, Academy /
Skills conformance, context assembly, authority / fail-closed, storage / runtime invariants). They
reported one BLOCKER and about twenty MAJOR findings. Every in-scope BLOCKER / MAJOR was fixed in
this task, each with a regression proof (`packages/storage/test/c3-review-fixes.test.ts`,
`C3-PROOF: review-fixes`, plus kernel and runtime proofs) and, for the most important gates, a C3
mutation.

**Decisions taken in the fixes.**
- **Wake-ups (the BLOCKER).** Resolving a memory conflict (Founder correction, canonical truth) wakes
  that Employee's work waiting `MEMORY_CONFLICT_REVIEW` in the same transaction; passport, freshness,
  rollout and rollback changes wake `SKILL_CONFLICT_REVIEW` and capability-gap waits of the affected
  Employees; approving a skill re-evaluates open gaps. The WAIT settle of a capability gap re-runs the
  gate in its own transaction (closing the window between gap and park). A Founder-cancelled gap
  wakes the work to end it (`CAPABILITY_GAP_CANCELLED`, audited, never re-routed).
- **Recovery isolation.** Pending memory candidates are decided one per transaction; an undecidable
  one is refused `POLICY_ERROR`; a candidate whose stored bytes no longer match their hash is refused
  `INTEGRITY_FAILED`.
- **Context.** L6 comes from `context_step_results` recorded by the runtime's Tool Executor / memory
  path wrappers (never the processor); only the newest result is required. Pools use the term index;
  canonical binding is structural; the conflict notice is planned and budgeted; a grant-based
  knowledge scope counts one use per assembly and stops at its limit, restricted use is audited like
  cross-department use; the preamble is labelled at the Work Item's declared class.
- **Compaction.** Summary sources are the topic's most recent live, claim-free, full-confidence
  memories (independent of the query), so a summary is reused across tasks and invalidated only when
  a source changes; any status change or corruption of a source invalidates the summaries built from
  it.
- **Memory.** Memories and lessons keep the Work Item's market; exact re-observation of a STALE memory
  re-validates it (the Founder can too); every memory / knowledge insert re-checks canonical truth,
  and canonical truth rejects contradicting pending lessons.
- **Data classes (fail-closed defaults for Product review).** D4 context is never retained as memory
  or learning (`DATA_CLASS_NOT_RETAINED`); shared promotion of D3 / D4 lessons is refused
  (`DATA_CLASS_NOT_SHAREABLE`).
- **Academy.** Evidence windows: a probation FAIL diagnoses a remediation, opens a new evidence epoch
  and returns through RETRY to new shadow work; EXTEND returns to SHADOW_WORK and opens a new review
  round; an activation REJECT closes the enrollment (WITHDRAWN) so the Employee may enroll again;
  `withdrawEnrollment` exists. Attempts that never completed are VOID (never scored). The rubric and
  shadow evidence count every refusal (`authority.denied`, `tool.refused`, `tool.review_required`).
  Assessment / holdout scenarios need a non-zero budget. Certification pins the passport's current
  version or the newest pinnable version not held by an unfinished update. An unchanged blueprint does
  not trigger recertification; a TARGETED skill update re-tests the skill (passport) but keeps the
  role certification VALID; PARTIAL / FULL mark it REVIEW_DUE.
- **Schema.** 0005 / 0006 were edited before release (never applied outside this branch) and re-pinned;
  0001–0004 are untouched.

**Re-review.** An adversarial re-review of the fix commit confirmed the dispositions above and found
three partial fixes and two regressions, reported as four MAJOR findings. All four were fixed in this
task, each with a regression proof (`C3 re-review fixes` in `c3-review-fixes.test.ts`) and a C3
mutation:
- **N3 — lost wakes at the park.** The WAIT settle of `MEMORY_CONFLICT_REVIEW` /
  `SKILL_CONFLICT_REVIEW` re-checks the held manifest in the same transaction
  (`txRecheckContextHold`). It wakes the work when no held memory is still live and in an OPEN
  conflict, or when a conflicting Skill version is no longer pinned and eligible. The capability
  re-check also wakes a gap cancelled while its run was in flight. A held memory leaving live state
  wakes the Employee's conflict waits. Issuing a certification wakes skill-conflict waits.
  Mutation: `context-hold-not-rechecked`.
- **N4 — term-index crowd-out.** The term index joins the item table and filters inside the query,
  before the LIMIT: live status and integrity for memory and canonical truth, and readable scope for
  knowledge. Dead or unreadable items can no longer push a live one out of the bounded pool.
  Mutation: `term-limit-before-filter`.
- **N1 — compaction across markets.** Only market-neutral memories are compacted; market-bound ones
  are always served one by one, subject to the market filter. Mutation: `compaction-crosses-markets`.
- **N2 — breaches hidden by failing.** A refused action is scored (`AUTHORITY_COMPLIANCE`) even when
  the attempt's work failed or never completed, so the critical failure fails the attempt. Only an
  attempt with no refusal and no completed work is VOID. Mutation: `failed-attempt-hides-breach`.
- **Minor fixes:**
  - A pending shared promotion of a lesson that contradicts new Canonical Truth is rejected
    (`CONTRADICTS_CANONICAL`).
  - Durable step results never store secret material.
  - Re-evaluating every open gap is deterministic and unbounded (no `LIMIT 1000`).
- **Minor items left to Product** (both since decided by the Founder):
  - After EXTEND, the next review may use the same epoch's cases. A new Founder decision is still
    required, but the number of additional cases is a Product value. → **Resolved by D-C3-20**: at
    least one new evidence item after the extension; no fixed count.
  - During RETRY, a practice (SIMULATION) attempt may still be started. → **Confirmed by D-C3-22
    (7.5)**: allowed; practice is never a holdout and never certification proof.

## D-C3-17 — Questions for the Product Owner (asked by the C3 candidate; now resolved)

The C3 candidate (`c8cbebf`) asked these questions. After an independent review of that head found no
new engineering BLOCKER or MAJOR, the Founder / Product Owner decided all of them (Founder decision
closure task, 2026-09-27). The questions are kept as asked, with where each one is resolved:

1. **Consequence of losing certification.** A REVOKED / EXPIRED / REVIEW_DUE certification blocks work
   that declares a CERTIFICATION requirement, but an ACTIVE Employee otherwise keeps executing. Should
   an ACTIVE Employee without a live role certification be moved to RETRAINING (or blocked)? The
   authority does not say. → **D-C3-18.**
2. **Approver identity.** Activation, evaluation and probation decisions are Founder-only in Strong v1
   (the schema requires `founder:*` for the activation decision and forbids `employee:*` evaluators).
   C4 (Review Pool / Directors) will need a migration to widen this; which roles may approve?
   → **D-C3-22 (7.1).**
3. **Licence policy.** The clear-free list and the review-required list (D-C3-08) need Product /
   legal confirmation. → **D-C3-21.**
4. **REVIEW_DUE semantics and recertification scope** per impact level (TARGETED / PARTIAL / FULL).
   → **D-C3-18** (REVIEW_DUE) and **D-C3-22 (7.2)** (scope).
5. **D3 / D4 retention and sharing** (fail-closed defaults above). → **D-C3-22 (7.3).**
6. **Numeric defaults**: confidence caps, review horizons, near-duplicate threshold, context budget and
   layer shares, compaction threshold, probation defaults, certification validity. → **D-C3-22 (7.4).**
7. **Founder Calibration placement**: C3 requires it (when the program demands it) before
   certification; Stage 6 §10 names it before Active Duty. → **D-C3-19.**

No imported canonical authority was edited. Stage 4 §8 (Retraining is a lifecycle state), Stage 6 §10
(Founder Calibration "before Active Duty"), §12 (probation is evidence-based) and §13, and Stage 7 §12
("No clear license / permission … → reject") agree with these decisions: no AUTHORITY CONFLICT.

## D-C3-18 — Founder Decision 1: loss of the current-role certification

**Founder decision.** A persistent Employee may not continue ordinary role execution after losing the
live certification that let its role become trusted. REVOKED or (clock-)EXPIRED → no new ordinary
role execution, governed move to RETRAINING, same identity, history kept. REVIEW_DUE → the Employee
stays ACTIVE; only work that explicitly requires that certification stays blocked until recertified.

**Implementation.**
- `roleCertificationLoss` (storage `mind-core`): the loss exists when the Employee holds no live
  (VALID / REVIEW_DUE, time-aware) certification for its **current** role and its latest one for that
  role is REVOKED or EXPIRED. Expiry is read from the clock and materialized (status + history row).
  **Scope boundary (engineering reading, not a Founder decision):** an ACTIVE Employee that never held
  a certification for its current role has lost nothing under this rule, so it is not moved. The one
  production case is a role reassignment of an ACTIVE Employee; it is surfaced as an open Product
  question in D-C3-23 rather than decided here.
- `enforceRoleCertification` runs inside the caller's transaction at every ordinary-duty boundary:
  run start (`txBeginGovernedRun`), model authorization, budget reservation and tool intent, and in
  `revokeCertification`. For an ACTIVE Employee with a loss it moves the Employee to RETRAINING (C2
  lifecycle already allows ACTIVE → RETRAINING; no new state) with reason
  `ROLE_CERTIFICATION_REVOKED` / `ROLE_CERTIFICATION_EXPIRED`, actor `system:runtime` (deterministic,
  never the Employee or a model), plus an `employee.certification_lost` audit row with the
  certification ID. RETRAINING cannot execute ordinary work (`canExecute`), so the run is refused
  (`EMPLOYEE_NOT_ELIGIBLE`) and an in-flight run spends and acts no further.
- A PAUSED / ON_LEAVE Employee is not moved when the loss happens; if it is resumed to ACTIVE, the
  first ordinary-duty boundary moves it. Academy attempts stay available: RETRAINING is a trainee
  state, and the way back is recertification, then the Founder's C2 lifecycle transition RETRAINING →
  SHADOW / PROBATION, then a new Activation Approval (`decideActivation` is the only path back to
  ACTIVE; the datastore gate refuses any other).
- Certifications, their history, evidence, portfolio and runs are never deleted or rewritten
  (datastore triggers already forbid it).
- REVIEW_DUE: unchanged capability gate — a CERTIFICATION requirement is unmet by REVIEW_DUE, so that
  work parks as a capability gap; nothing demotes the Employee.

## D-C3-19 — Founder Decision 2: Founder Calibration gates Activation, not certification

**Founder decision.** Founder Calibration is a pre-Activation requirement for designated roles, not a
prerequisite of the professional Role Certification. Certification stays necessary, not sufficient.

**Implementation.**
- The kernel's `certificationGaps` no longer contains `FOUNDER_CALIBRATION`; a designated role is
  certified when its professional evidence is complete, even with calibration PENDING.
- New pure `calibrationActivationGap(def, state)`: a program that requires calibration needs this
  enrollment's calibration APPROVED (`CALIBRATION_PENDING` / `CALIBRATION_REJECTED` /
  `CALIBRATION_MISSING` otherwise); other programs are unaffected.
- `decideActivation` re-reads the enrollment's calibration at decision time (not what the request
  recorded when filed) and refuses with `EMPLOYEE_NOT_ELIGIBLE` and that reason; on approval it records
  the approved calibration on the request as activation evidence.
- **Migration 0006 amended (unreleased; re-pinned).** The datastore's `employees_activation_gate`
  now also requires that, when the enrollment has a Founder Calibration row (a designated role), it is
  APPROVED and is the one the approved request records. Before this decision calibration was implied
  by the certification; moving it after certification would otherwise have removed it from the
  datastore's defence in depth. SHA-256 `d3052dc4…4a90cb0` → `a4b87099…637d57d8`.

## D-C3-20 — Founder Decision 3: probation EXTEND needs new evidence

**Founder decision.** After EXTEND the next review needs new post-extension evidence; no hard numeric
count is frozen in C3; the next review remains evidence-based and needs a new decision.

**Implementation.** The EXTEND review row (append-only, same evidence epoch, `review_round`) is the
durable extension boundary: its `summary_json` records the evidence counts at the decision. Evidence is
append-only, so a higher positive-evidence total in the same epoch means at least one positive item was
recorded after the extension. Until then the enrollment stays in SHADOW_WORK (`advance`) and a PASS is
refused (`NO_EVIDENCE_AFTER_EXTENSION`, defence in depth). Old evidence stays and counts alongside the
new; a negative item does not qualify. The boundary survives a restart (it is a committed row). No new
column or Product metric: a later Product value for the amount / type of extra evidence can replace
the "at least one" comparison.

## D-C3-21 — Founder Decision 4: Skill licence policy

**Founder decision.** Keep the fail-closed licence model. Clearly permissive licences auto-clear; the
**Unlicense moves to the review-required path**; attribution / copyleft / share-alike stay
review-required; unknown / missing / NOASSERTION / unclear / proprietary / paid / trial stay rejected.
This is a Product risk posture, not a legal conclusion or a statement about any licence's validity.

**Implementation.** `CLEAR_FREE_LICENSES` = MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD,
CC0-1.0; `REVIEW_LICENSES` gains `Unlicense`. An Unlicense version waits at LICENSE_DEPENDENCY_CHECKED
for the existing recorded `reviewLicense` (→ `CLEARED_BY_REVIEW` with evidence, or REJECT).

## D-C3-22 — Other Founder dispositions (recorded; no new mechanism)

1. **Approver identity (7.1).** C3 production approval / evaluation / probation / activation stays
   Founder-only and fail-closed on the authenticated Founder surface. No Directors or Review Pool
   authority in C3; widening it is C4's.
2. **REVIEW_DUE recertification scope (7.2).** Unchanged: TARGETED re-tests the affected Skill /
   Passport scope without invalidating the role certification; PARTIAL / FULL make the role
   certification REVIEW_DUE.
3. **D3 / D4 (7.3).** Unchanged: D4 is never retained as ordinary Memory / learning and stays
   local-only under security authority; D3 is never silently promoted or shared as ordinary shared
   knowledge; no new D3 sharing mechanism.
4. **Numeric defaults (7.4).** Confidence caps, review horizons, duplicate thresholds, context budgets
   and layer shares, compaction thresholds, probation defaults, certification validity and similar
   values are **engineering defaults / tunable policy values**, not frozen Product constants.
5. **Practice during RETRY (7.5).** Allowed. A practice (SIMULATION) attempt only uses PRACTICE
   scenarios (a holdout is refused, `HOLDOUT_NOT_FOR_PRACTICE`, and stays unexposed), and only passed
   ASSESSMENT attempts count toward certification; a passed practice in RETRY neither skips retraining
   nor certifies. Proved in `c3-founder-decisions.test.ts`.

**Mutations added** (`scripts/c3-mutation-check.mjs`, 30 → 39): `role-cert-loss-ignored`,
`role-cert-loss-not-at-run-start`, `role-cert-loss-not-at-authorization`,
`role-cert-loss-not-at-reservation`, `role-cert-loss-not-at-tool-intent`,
`calibration-not-required-at-activation`, `calibration-gates-certification`,
`extension-evidence-not-required`, `unlicense-auto-clears`. The datastore calibration clause of the
activation gate is proved directly (a raw write that skips `decideActivation` is refused); it is not a
compiled-output mutation because editing a pinned migration already fails every test.

## D-C3-23 — Open Product questions surfaced by the closure review (not decided here)

A focused adversarial review of the D-C3-18 .. D-C3-22 changes found no BLOCKER. It surfaced these
Product consequences, which C3 does not decide (no new Product policy may be invented):

1. **RESOLVED — role reassignment of an ACTIVE Employee.** The Founder decided this in
   **D-C3-24**: the assignment is recorded, but if the Employee does not already hold a currently
   **VALID** certification for the target role, the same atomic write moves it to RETRAINING. A prior
   certification for another role remains history and grants no Active duty in the new role.
2. **MINOR (Product) — calibration at recertification of an ACTIVE Employee.** D-C3-19 makes
   calibration an activation requirement; an Employee already ACTIVE that recertifies a designated role
   is not re-activated, so its calibration is not re-checked. Should recertification of an ACTIVE
   designated-role Employee also require a current calibration?
3. **MINOR (Product) — post-extension evidence.** D-C3-20 counts evidence *recorded* after EXTEND; an
   evaluator may record a new positive item about shadow work finished before the extension. Whether
   the new evidence must also come from work done after the extension is a Product tuning of D-C3-20.
4. **Note — expiry fails ordinary work.** As for any non-executing Employee (C2), an ordinary Work Item
   whose run is refused because its Employee moved to RETRAINING ends `EMPLOYEE_CONTAINED`; it is not
   parked or re-routed (re-routing is forbidden). Non-spending steps of a run begun before the loss may
   still settle; its model calls, reservations and tool intents are refused.

## D-C3-24 — Founder Decision: ACTIVE role reassignment without target-role certification

**Founder decision.** A role change may be recorded without first refusing the assignment, preserving
the same Employee identity and history. If an Employee is ACTIVE and the `role_ref` actually changes,
ordinary Active duty carries into the target role **only** when the Employee already holds a
time-current **VALID** certification for that target role. Otherwise the reassignment is recorded and,
in the same transaction, the Employee moves to RETRAINING. The previous role's certification and all
prior evidence remain durable history.

The Employee does not regain Active duty merely by receiving a new certification after that demotion;
the existing Academy / Activation Approval path remains the route back to ACTIVE. REVIEW_DUE is not
sufficient for entry into a newly assigned role because the target-role qualification must be VALID at
the reassignment boundary. Non-role assignment changes do not trigger this rule.

**Implementation.** `GovernanceStore.reassignEmployee` reuses C3's time-aware
`liveCertifications(..., materialize=true)` authority. A changed role on an ACTIVE Employee with no
VALID target-role certification records the ASSIGNMENT first and then records
`ACTIVE → RETRAINING` with reason `ROLE_REASSIGNMENT_REQUIRES_CERTIFICATION`, atomically under the
Founder's administrative transaction. Two direct proofs cover both sides: missing target certification
demotes; returning to a role whose prior certification is still VALID remains ACTIVE. Mutation
`role-reassignment-without-cert-keeps-active` proves the gate is effective.

**State.** C3 is **CLOSED / MERGED / CANONICAL**. The final independent review and Founder-host
validation passed on candidate `4284337221706f08aebe65fadb64c881c8ed9470`; the final pre-merge closure
head was `e4fdaa119eeef4cb612e349f962adb38108a62f8`; PR #4 merged to `main` on 2026-09-27 as
`4592b525bdc4937dd130dac452a7dc8fc29de909`. The closure is recorded in `docs/C3_CLOSURE_RECORD.md`.
R1 and C4 remain NOT STARTED.

## D-R1-01 — R1 Independent Core Review: engineering remediation (no Product decision)

**Context.** R1 reviewed the canonical C1 + C2 + C3 core at `c6a17c3` as one system (ten independent
adversarial angles plus the reviewer's own verification; `docs/R1_INDEPENDENT_CORE_REVIEW_REPORT.md`).
It found no BLOCKER and 15 MAJOR engineering defects, each inside already-approved authority. Every one
was fixed at its root cause with a regression proof and a mutation (`npm run r1:mutation`, in `ci`).
No imported authority was edited and no Product decision was taken; the questions the review could not
decide are surfaced as `PRODUCT OWNER DECISION REQUIRED` in the report.

**Engineering decisions taken in the fixes.**
- **Work-Item-global steps (R1-03).** A governed job's loop step counts per job (checkpoints are per
  job), while idempotency keys, step results and memory candidates are keyed per Work Item. The runtime
  now adds a durable per-job base (`job ordinal × GOVERNED_STEP_SPAN`, span 100; the loop allows 32
  turns) before anything keyed per Work Item is written. The first job's base is 0, so every existing
  key is unchanged; a resumed run of the same job presents the same keys (D-C2-07 unchanged); a new
  job of a re-released / reworked Work Item can no longer collide with an earlier job's keys (a false
  `IDEMPOTENCY_CONFLICT` that counted toward the authority pause, or a silent stale REPLAY).
- **Governed reconciliation (R1-04).** The C1 job-level `resolveReconciliation` stays the operator
  decision for plain C1 work. For governed (Employee-attributed) work it is Founder authority through
  the shared Founder-authority write (fail closed, `FOUNDER_SURFACE_UNAVAILABLE`, until C5) and is
  refused while the Work Item still has an uncertain tool invocation (`resolveToolInvocation` first).
- **C2 wait re-check at the settle (R1-06).** As C3 already did for its waits, the WAIT settle of
  `AWAITING_APPROVAL` / `BUDGET_EXHAUSTED` re-checks its durable predicate in the same transaction (no
  pending tool approval left; a cap on the Work Item's budget chain changed since the run began) and
  wakes the job if the wait no longer holds. A spurious wake costs nothing: every gate re-runs.
- **Grants wake capability gaps (R1-07)**; **approval release honours dependencies (R1-05)**.
- **Model-call accounting is contained (R1-09).** Post-call bookkeeping that fails holds the
  reservation (`SETTLEMENT_FAILED`) and holds the deployment (`CONTRACT_VIOLATION`); every run settle
  also holds any model-call reservation of that run still `RESERVED` (`RUN_ENDED_UNSETTLED`).
- **In-process active runs are keyed by run (R1-08)**; a run whose claim was interrupted is fenced
  before its job can be re-claimed; shutdown interrupts only claims this process still holds.
- **Every attempt closure scores refusals (R1-10)**; a cancelled / superseded shadow item's refusals
  are collected as critical failures; a closed attempt's unfinished Work Item is cancelled.
- **Reassignment at the duty boundary (R1-11).** D-C3-24's rule ("Active duty carries into a changed
  role only with a VALID target-role certification") also applies to `PAUSED` (which resumes straight
  to ACTIVE; `PAUSED → RETRAINING` is an existing transition). `ON_LEAVE` has no RETRAINING transition:
  until the Product Owner decides (P-01), a role change of an `ON_LEAVE` Employee without the target
  certification is refused (fail closed; nothing new is invented).
- **Retrieval eligibility before the LIMIT, rejection evidence kept (R1-12).** Memory and knowledge
  each use two bounded term-matched pools: an ELIGIBLE pool (class within the ceiling, market-neutral
  or the Work Item's market, review horizon not passed — decided in SQL before the LIMIT, so nothing
  ineligible can crowd an eligible item out, D-C3-16 N4) and a separate REJECTION-EVIDENCE pool of
  readable but ineligible items, which stay candidates so the manifest still records
  `DATA_CLASS_ABOVE_CONTEXT` / `MARKET_MISMATCH` (D-C3-06); unreadable scopes are never candidates
  (D-C3-04). Memories past their horizon take no pool slot and are marked STALE and recorded as
  rejected. (A first version filtered the ineligible items out entirely; three C3 proofs caught the
  lost rejection evidence, and the two-pool form replaced it.)
- **Lower layers are data (R1-13)**: knowledge / memory / recent-result text is rendered with any
  line that would open like a layer marker, item header or precedence line neutralized (same UTF-8
  length, so budgets stay exact).
- **Secret material (R1-01)**: the detector covers the formats the review found passing (hyphenated
  provider keys, payment keys, fine-grained GitHub tokens, JWTs, OAuth tokens, `Bearer`, URL
  credentials, JSON-quoted pairs, "password is …", Arabic) on NFKC / zero-width-folded text, in linear
  time; results are scanned before they are bounded; claim fields are scanned; a secret-bearing tool
  result is stored as a digest only; secret-bearing instructions never reach a provider.
- **Tool arguments by own fields only (R1-02)**; proposal codes are length-bounded (K4); a FINAL
  decision is checkpointed as FINAL and honoured on resume (B-F4); D4 retention uses the class at the
  decision too (G-4); a malformed backup manifest keeps the stable error code (C-F5).
- **Proof integrity (R1-14, R1-15).** Released migrations 0005 / 0006 are frozen by content; the test
  runner requires a passing test in EVERY test file (a proof file emptied to its marker now fails); the
  verifier pins every recorded mutation and the mutation machinery (`mutation-checks-pinned`); the
  bootstrap workspace uses the vacuity-checked runner.

**Independent re-review of the remediation.** Two fresh adversarial re-reviews of the remediation
commit found defects that the first remediation itself introduced or left incomplete; each was fixed
at its root with a proof and a mutation (`r1:mutation` 22 → 28):
- **The widened secret detector (R1-01) was super-linear on crafted input and over-matched prose.**
  Every pattern that can fail after reading a long run is now bounded (no adjacent unbounded
  quantifiers; the Arabic separator is one bounded class), a scan reads at most
  `SECRET_SCAN_MAX_CHARS` (16 384; every stored form is smaller), and the credential-keyword rules
  require a credential-shaped value (an explicit separator, then one token containing a digit), so
  ordinary support prose about passwords / keys / PINs in English and Arabic is not refused (see the final round below for the remaining trade-off). HTTP Basic
  credentials are detected. Step results get the credential-named-key guard the tool invocation
  record already had. A checkpointed FINAL decision is honoured before input validation.
- **R1-12 was incomplete for knowledge and for conflict-held memory**: knowledge eligibility includes
  the review horizon, memory eligibility excludes memories held in an OPEN conflict; both stay
  rejection evidence (STALE / CONFLICT_UNRESOLVED) in the separate bounded pool.
- **R1-13 neutralization** also recognises Unicode spacing / invisible prefixes, VT / FF / NEL line
  starts, full-width brackets / letters and any decimal digit, only for the real item-header grammar,
  still length-preserving and linear.
- **R1-06** also wakes when a tool approval of the Work Item was decided during the run (a stale
  PENDING request of an earlier job no longer masks it).
- **R1-03** refuses a job whose step range would pass the durable bound (`STEP_RANGE_EXHAUSTED`,
  before anything executes). **R1-09**: deployment health is recorded best effort after the money
  write, and local store contention is never recorded as a provider `CONTRACT_VIOLATION`.
- **R1-15**: the verifier also refuses a mutation script that can exit successfully before running
  its mutations or reports PASS before its loop.
**Final re-review round.** A last pair of re-reviews of `fe45500` found one more MAJOR introduced by
that commit — moving conflict-held memories into the shared rejection-evidence pool let 300+ other
rejected memories crowd the conflict pair out, so IMPORTANT work could run without `CONFLICT_HOLD` —
fixed with a dedicated bounded pool for conflict-held memories (proof + mutation
`r1-12-conflict-pool-dropped`), and a test-only flake (a proof read "the last job" by a timestamp the
manual clock makes equal; it now reads the job it claimed). MINOR follow-ups fixed: a provider fault
is decided from the provider's answer before any store write (never inferred from a local error);
quantities ("12-character") and look-alike words (Secretary, Passwords) are not credentials, while
`_`-joined credential names still are; HTTP Basic requires base64 shape; invisible-character folding
and marker neutralization cover every Unicode format character; the verifier refuses any exit before a
mutation loop. **Accepted trade-off (recorded, not a Product decision):** credential-keyword values
must carry a digit, so a digit-free password written in prose (`password: hunter-two-horse`) is no
longer caught by the text rules (structured results are still guarded by credential-named keys).
**Confirmation round.** Re-reviews of `805a1f5` found one more MAJOR of the same class: the conflict pool
admitted conflicted memories of any class / market, which the planner rejects before it considers
conflicts, so a flood of them could still displace the in-class pair. The conflict pool now holds only
conflicts that can hold THIS work (class within the ceiling, market-eligible); ineligible conflicted
memories remain rejection evidence (proof + mutation `r1-12-conflict-pool-unrestricted`). MINOR:
the item-header neutralization lookahead is bounded and cheap again; a quantity exclusion needs a word
after the number (`1234-abcd-9876` is still a credential); usage over the enforced bounds counts as a
provider contract violation.
**Last confirmation round.** Re-reviews of `621d107` found no BLOCKER / MAJOR. One MINOR was closed:
the over-bounds attribution line had no committed proof (only the older out-of-range proof, which a
different path catches); it now has one (one token over the step bound plus contention at the settle →
the deployment is held on the first attempt) and mutation `r1-09-over-bounds-usage-not-blamed`.

**Technical Lead exact-head review (MAJOR follow-up under R1-09; engineering, not a Product
decision).** At `0ac427e` a provider usage contract violation was contained non-durably: the money
settlement and the deployment `CONTRACT_VIOLATION` hold were separate transactions, the second best
effort, so a failed health write left a known violator `ACTIVE` and routable. Decision: **a known
provider fault and its money record commit in one fenced transaction.** A model-call settle whose usage
is outside the enforced bounds contains the reservation's own deployment inside the settle transaction;
`containProviderFault` holds the money and contains the deployment atomically (unusable usage,
malformed answer, containment after a failed settle). Healthy-answer health stays best effort, so local
contention never holds or blames a healthy provider. When the store refuses even the containment,
nothing durable names the provider; the process keeps the deployment out of its routing and writes the
containment at the next route boundary (the money is held by the existing hold / backstop / recovery).
A failed call reporting over-bounds usage is a contract violation (no same-route retry). No new table,
migration or routing mechanism. Proofs: 4 runtime + 2 storage; mutations
`r1-09-provider-fault-hold-not-durable`, `r1-09-malformed-answer-hold-split`,
`r1-09-uncontained-violator-routable`; two R1-09 mutations re-targeted to the moved containment method.
The focused re-review of that fix (`3aa458d`) found one more MAJOR on the same boundary: a charged
failure the provider classified `CONTRACT_VIOLATION` (within-bounds usage) settled without the
containment. The runtime's provider-fault verdict is now carried into the settle transaction
(`settleReservation(…, providerFault)`), so such a failure settles and contains together (proof +
mutation `r1-09-charged-violation-verdict-dropped`). An over-bounds charged failure is counted once
toward the circuit, and the in-process routing exclusion has its own proof (mutation
`r1-09-uncontained-filter-removed`). A second focused re-review (`59449c2`) found no BLOCKER / MAJOR.
Its MINORs were fixed:
- The adapter's answer is snapshotted once at the adapter boundary. An answer object whose fields
  cannot be read is the provider's contract violation, never an escaped error that retries a paid
  route.
- Each unusable-usage branch has its own proof and single-branch mutation. A failed call with
  unusable usage holds its money as `USAGE_UNUSABLE`.

**Closure-cycle rule (Product / Technical Lead).** Once an exact-head full validation has passed (`npm
ci`, `npm run ci`, C1/C2/C3 acceptances, `git diff --check`), the final focused adversarial re-review
decides the outcome:
- A BLOCKER or MAJOR is fixed, the gate is invalidated, and validation is re-run.
- A MINOR is recorded as a residual, with no code change and no new full validation in this cycle.

R1 closure requires zero unresolved BLOCKER and zero unresolved MAJOR.

The final re-review of `b0ac2b7` reproduced one MAJOR. The answer snapshot copied the usage object by
reference, so a shifting getter plus one refused write left a violator routable and paid again. The
usage values are now snapshotted once at the adapter boundary (proof + mutation
`r1-09-usage-snapshot-shallow`), and the gate was re-run. Its MINORs are residuals (report N-ADAPTER):
an unguarded read of a thrown error's own getters, and loss on crash of an in-process exclusion.

The final re-review of `8064fc9` reproduced one more MAJOR with the same root cause, on the thrown-failure
path: a charged `ProviderError`'s usage object was read live twice. The thrown failure's usage is now
snapshotted to values by the same single, guarded read (an unreadable failure object is a contract
violation). The guard also closes the thrown-error-getter residual. Proof + mutation
`r1-09-thrown-usage-snapshot-shallow`; the gate was re-run.

The final re-review of `b309b11` reproduced one more MAJOR, predating R1: `classifyProviderError` read
a thrown failure's class twice, validating the first read and using the second. A shifting getter
could therefore index an `Object.prototype` member of the dispositions table and release
possibly-billed money. Decision: **every field of a provider's answer or thrown failure is read exactly
once, and the value validated is the value used.** The class is read once and only a listed class is
returned (proof + mutation `r1-09-failure-class-read-twice`).

**Provider boundary (Technical Lead direction, engineering decision).** The repeated R1-09 findings are
one defect family, so the fix is architectural: `packages/runtime/src/c2/provider-boundary.ts` is the
only code that reads a provider's answer or thrown failure. It reads every provider-controlled field
exactly once, inside a guard, validates the values, and returns a frozen snapshot of plain values
(answered, text, listed failure class, usage state and values, provider-fault verdict). Money, retry,
health and containment decisions use only the snapshot. Failure classes are validated by set
membership, and dispositions are looked up by own key only (`failureDisposition`, also used by
storage). One centralized invariant proof, with hostile Proxies, and three boundary mutations protect
it. Two mutations of the removed per-path snapshot code were retired; the boundary invariant covers
them.

The boundary sweep found one MAJOR: the adapter race compared a provider's raw value with the
timeout strings. Runtime-control outcomes are now module-private `unique symbol` markers, so no
provider value can equal them (mutation `r1-09-control-marker-forgeable`).

**Retry after a charged attempt (Technical Lead decision, MAJOR).** The retry contract allows a
same-deployment retry only for transient failures that were not billed. The runtime keyed the retry on
the failure class alone, so a TRANSIENT failure that reported usage was settled `FAILED_CHARGED` and
then retried on the same deployment.

Decision: the observed accounting of the specific attempt constrains retry eligibility. `#account`
returns `UNBILLED` (released), `CHARGED` (settled `FAILED_CHARGED`) or `HELD` (held for
reconciliation), and only an `UNBILLED` attempt may be retried on the same deployment. Fallback
policy and the failure taxonomy are unchanged. Proof covers both sides; mutation
`r1-09-charged-attempt-retried`.

**Documentation note (R1 B-F6).** D-C2-07's first bullet list says an orphaned NONE / IDEMPOTENT tool
intent's reservation "is released". D-C2-12 (MAJOR, "interrupted tool intents released money that may
have been spent") amended that to "charged (`FAILED_CHARGED`), never released", and the code follows
D-C2-12. D-C2-07 is read with that amendment; it is not rewritten here.

**State.** Technical Lead exact-head review passed with 0 BLOCKER / 0 MAJOR. PR #6 merged into canonical `main` as `bd18614d1fc49d3c03ace2289e19accd67aa1838`; exact-head PR CI run #60 and post-merge `main` CI run #62 passed on Windows and Ubuntu. R1 is **CLOSED / MERGED / CANONICAL**. C4 is READY / NOT STARTED pending this docs-sync merge.


## D-R1-02 — Cross-stage integration and bounded validation (Product Owner / Technical Lead)

**Problem exposed by R1.** C1, C2 and C3 each passed their own closure gates, but R1 found cross-layer
defects that only appeared when the core was exercised as one system. The Product Owner requires every
later stage to be designed and reviewed as an extension of the whole Company, not as an isolated feature.

**Decision.** From C4 onward every implementation task must include:
- a **Backward Integration Gate** over every closed-stage contract / invariant it touches;
- a **Forward Integration Gate** over the known next-stage / Product requirements so current contracts
  preserve the required extension seams without inventing unknown future behaviour;
- **boundary-first design** for authority, money, durable lifecycle, recovery, privacy, routing and
  external / mutable-data boundaries, with focused adversarial proofs during implementation;
- **R1 defect-family non-regression**: prevent the root anti-pattern where relevant, not only the literal
  regression; repeated same-root failures are an architecture signal;
- a **bounded validation workflow**: fast / focused checks while building, one complete closure gate on
  the real final candidate, MINORs after that gate are recorded without restarting it, and a
  BLOCKER / MAJOR returns to Technical Lead disposition instead of opening an autonomous fix loop;
- at most **two correction cycles for one root-cause family**; a third recurrence requires architecture
  review before more coding;
- a closure **Integration Matrix** recording prior-stage contracts touched, proof they remain valid, new
  contracts exposed to the next stage, residual / deferred decisions and confirmation of no scope leak.

This is a process / integration correction, not a new stage and not authority to split the roadmap into
extra micro-phases.

**Roadmap intent.** C4 builds Organization / CEO / Directors / Positions / staffing / delegation /
Review Pool on the existing C1–C3 mechanisms. C5 consumes that foundation for the Founder Command
Center, Founder↔CEO operating relationship, approvals / delegation controls and Company Calendar
foundation. C6 consumes real work lineage for employee / department performance, reporting, learning,
evaluation, resilience and outcome analytics. C7 connects governed Company operations to APP-OPS /
Pilot instrumentation and external outcome data without weakening privacy, authority, accounting or
recovery boundaries.

## D-R1-03 — P-07: charged-deployment exclusion extends to the logical job (Product Owner / Technical Lead)

**Decision.** Once a deployment has produced a **charged failed attempt**, that deployment must not be
automatically selected again for the same logical job / Work Item merely because execution crossed a
call or run boundary. A later use requires explicit new authority / evidence / policy rather than an
automatic job retry.

R1 already enforces the rule within one model call. The remaining job-scope enforcement identified by
N-RETRY M1 is **non-blocking for R1** and is deferred to the next appropriate implementation stage,
but it must be implemented **before any paid Pilot operation**. Every charge remains recorded truthfully
in the meantime.


## D-R1-04 — CEO executive layer and progressive staffing delegation (Product Owner amendment)

**Direct Product Owner decision, 2026-09-28.** The Company will have a persistent **CEO** as the senior
executive Employee under Founder and above Department Directors. This is a deliberate refinement of the
Stage 10 Strong-v1 default hierarchy (Founder → Directors): implementation from C4 onward uses

Founder → CEO → Directors → justified Managers / Leads → Employees.

This does not transfer Founder sovereignty to the CEO and does not change Stage 3's core authority
principle: **title ≠ authority**. CEO is an Employee with persistent identity, Role / Position,
certification and governed authority. R4 remains Founder-only.

**Initial trust-building.**
- Founder expects high-frequency direct conversation with the CEO, implemented in C5's Founder Command
  Center rather than C4.
- Directors identify Department staffing / capacity needs and create governed Staffing Requests.
- CEO synthesizes, challenges and prioritizes those requests into decision-ready proposals.
- Permanent Employee creation remains Founder-approved initially.

**Progressive delegation.** Founder may later grant the CEO explicit, scoped, capped, auditable and
revocable staffing / hiring authority. A delegation may constrain Department, role families, headcount,
budget, cost, duration, risk and other policy dimensions. CEO title alone never grants hiring authority.
Director requests do not authorize hiring by themselves. R4 and any non-delegated R3 authority remain
with Founder.

**Department / headcount clarification.** Stage 10 already fixes the Strong-v1 Department Map as:
Strategic Market Intelligence, Growth, Brand & Creative, and Product, subject to its Department
Creation Rule and later evidence-driven growth / shrinkage. It does **not** fix a uniform headcount;
Department size, Positions and direct reports remain evidence-driven. Low-frequency functions may stay
Capabilities / Temporary Specialists as Stage 10 specifies.

**Forward contracts.** C4 must preserve durable organization / staffing / attribution state for:
- C5: Founder↔CEO operating conversation, approvals, delegation controls and Company Calendar;
- C6: outcome-based CEO / Director / employee / Department performance analysis;
- C7 / Pilots: external outcome instrumentation such as campaign, content, SEO, traffic and conversion
  evidence where those sources are explicitly integrated.

C4 builds only the foundation and may not implement the C5 UI / conversation surface, C6 analytics
engine or C7 external integrations.


## D-R1-05 — Engineering is a permanent C4 Department from day one (Product Owner amendment)

**Direct Product Owner decision, 2026-09-28.**

Stage 10 originally allowed Engineering to remain a capability until after the first successful company
pilot / until durable workload and management responsibility justified a formal Department.

The Product Owner explicitly supersedes that timing choice for implementation:

> **Engineering is a permanent Strong-v1 Department from C4 onward, present from the beginning alongside
> Strategic Market Intelligence, Growth, Brand & Creative, and Product.**

Therefore the C4 Strong-v1 Department Map is:

1. Strategic Market Intelligence
2. Growth
3. Brand & Creative
4. Product
5. Engineering

This changes **department timing**, not the existing authority model:
- Engineering Director title grants no authority by itself.
- Production, merge, deployment, security, budget and tool authority still come only from explicit
  grants/policies and the Stage 3 risk/approval model.
- Founder retains Founder-level authority and R4 sovereignty.
- Engineering staffing/headcount remains evidence-driven; this decision creates the Department, not a
  fixed number of Employees or seats.

**Engineering Department responsibility in C4.** Its durable Charter must support ownership of
software engineering delivery, architecture quality, implementation reliability, code/repository
health, testing/release engineering, production-readiness coordination and technical debt/risk
management, while respecting Product authority and cross-department ownership boundaries.

C4 must create the Engineering Department and Director Position as first-class organization state.
Actual staffing, individual Employee identities and delegated production/merge authority remain
separate governed decisions.

This amendment is binding for C4 and later implementation and should be reflected in C5 organization
visibility and C6 Department-performance reporting.


## D-R1-06 — Organization scaling is an operational workflow, not a code change (Product Owner amendment)

**Direct Product Owner requirement, 2026-09-28.**

C4 must make post-C4 workforce sizing a normal governed company operation rather than an engineering
change. Founder will initially work with CEO and Department Directors to determine the justified
Positions/headcount after the executive structure is present.

Therefore, after C4:
- adding, pausing, retiring or re-opening a Position inside an existing governed organization must not
  require a schema migration, source-code change or application redeploy merely because headcount
  changed;
- creating a Staffing Request, approving a Position, assigning an Employee, transferring/reassigning an
  Employee, and changing acting/permanent coverage are durable data/workflow operations;
- organization history and prior Work/Run attribution must remain intact after current staffing changes;
- authority, budget, Academy/certification and lifecycle gates still apply: operational simplicity must
  not become a bypass.

The initial expected management flow is Founder → CEO → Directors: discuss actual workload/capability
needs first, then decide justified Positions and Employee count. C4 builds the generic organization
mechanism; it must not hard-code a fixed Employee count per Department.


## D-R1-07 — Single heavy CI gate with conditional post-merge revalidation (Product Owner / Technical Lead)

**Problem.** The current GitHub workflow runs the same full Windows + Ubuntu matrix on both `pull_request` and `push` to `main`. Together with Founder-host validation this can repeat the same heavy Windows proof two or three times, adding hours without proportionate new evidence.

**Decision.** From C4 onward use a single-heavy-gate closure model:

1. **Development:** focused fast checks only.
2. **Founder host:** run only host-specific evidence that GitHub Windows cannot prove efficiently (Smart App Control / local workspace / Arabic-path / actual local-runtime acceptance and other explicitly host-specific checks). Do not duplicate the whole portable test+mutation suite merely because the machine is Windows.
3. **PR exact-head:** this is the single authoritative full CI gate. Run the complete Windows + Ubuntu matrix, full tests, mutations, verifier and required acceptances once on the real closure candidate.
4. **Post-merge `main`:** do NOT automatically repeat the full Windows + Ubuntu suite when the canonical merge tree is byte-for-byte the already-green PR tree. Run a fast merge-integrity / canonical-state check instead.
5. **Fallback:** if the merge tree differs from the validated PR tree, the merge method is not the expected merge-commit form, relevant CI/workflow semantics changed in a way not covered by the PR gate, or integrity cannot be proven, run the full post-merge CI fail-closed.
6. **Scheduled/manual safety:** a periodic/manual full-main CI remains available for drift/toolchain detection without blocking every normal merge.

For the Company's normal merge-commit flow, the post-merge integrity gate should compare the canonical merge commit tree with the validated PR-head parent tree (for example via Git tree hashes). Equality inherits the exact tested code/content; inequality requires revalidation.

This optimization changes **validation duplication**, not quality gates. No merge occurs unless the PR exact-head full gate, Technical Lead review and required Founder-host-specific checks already pass.


## D-C4-01 — C4 lives in the existing packages; no second engine (Technical Lead, C4)

**Decision.** C4 adds no package and no policy engine. Pure, deterministic rules live in `governance`
(`organization.ts`, `review.ts`, the `ORG_ACTION` / `REVIEW_DECISION` proposals, the R2 / R3 review
decision in `authority.ts`); durable state and every write live in `storage` (`org-core`, `organization`,
`org-writes`, `review-core`, `review`, migrations 0007 / 0008); orchestration lives in `runtime` (the
employee loop, the services, P-07 routing, health, the read-only CLI). OpenFGA / Casbin / a policy server
are not needed: the existing default-deny grant model expresses every C4 authority, including Founder →
CEO staffing delegation (a scoped, capped, expiring, revocable grant plus a delegation record with
policy limits). **Why:** one authority model, one budget engine, one accounting truth (R1 lesson: two
places that decide the same thing drift).

## D-C4-02 — Company-scoped executives: C2 schema evolution, not a fake Department (Technical Lead, C4)

**Context.** The Legacy Organization Dependency Census (`docs/C4_IMPLEMENTATION_REPORT.md` §2) found
`department_id NOT NULL` in `employees`, `run_attributions`, `budget_reservations` and `usage_records`,
a budget-chain check that required `RUN → WORK_ITEM → EMPLOYEE → DEPARTMENT → COMPANY`, and a budgets
design (one Employee budget forever, immutable parent) that made a transfer or a promotion into the
CEO seat unbudgetable.

**Decision.** Migration 0007 rebuilds those five tables inside its single transaction (TEMP copy →
drop → re-create verbatim → copy every row back → re-create every index and trigger; parent references
deferred to COMMIT, so a dangling reference fails the migration). `department_id` becomes nullable under
an explicit `org_scope` invariant (`(org_scope = 'DEPARTMENT') = (department_id IS NOT NULL)`); a
company-scoped run reserves through `WORK_ITEM → EMPLOYEE → COMPANY` (every Company cap still applies);
Employee budgets become per-placement envelopes (`status OPEN/CLOSED`, one OPEN per Employee): a
placement that changes the parent closes the old envelope — its spend history stays where it was spent
— and opens a successor capped by both. No Executive Department, sentinel row or Department budget is
created for the CEO. The five canonical Departments are seeded, adopting an existing row with the same
code (never duplicated or renamed). Proven on real v6 workspaces (rows, foreign keys and
`integrity_check` identical) and by a v6 → v8 upgrade test. The migration-hygiene test now forbids any
`DROP TABLE` except this exact row-preserving pattern (and still any `DELETE FROM` / `ON DELETE CASCADE`).

## D-C4-03 — Positions and effective-dated assignments are canonical organization truth (Technical Lead, C4)

**Decision.** `org_positions` (seats: CEO / DIRECTOR / MANAGER / LEAD / SPECIALIST; a title is a label)
and `position_assignments` (PRIMARY or ACTING, effective-dated, never rewritten) are the organization's
truth. One rule answers "who holds a seat at T": a valid ACTING assignment at T, else the PRIMARY one at
T, else vacant. Partial unique indexes keep one live CEO seat, one Director seat per Department, one
active PRIMARY per seat, one active ACTING per seat and one PRIMARY seat per Employee (proven under a
five-process race). `employees.department_id / position_ref / manager_ref / org_scope` are a projection
rewritten by the one C2 reassignment path — so the role-change certification rule (D-C3-24 / P-01)
applies unchanged — and an organization-managed Employee can no longer be moved behind the
organization's back (`ORG_MANAGED_EMPLOYEE`). Acting coverage is bounded (≤ 90 days, tunable policy),
ends by time without any write, is materialized EXPIRED at the next run start / recovery, and authority
delegated for it is revoked with it. Every governed run gets an immutable `run_org_snapshots` row (C6
seam). Headcount is data: Positions are added, paused, re-opened and retired without code (D-R1-06).
The Founder stays a principal: the CEO seat's manager is the Founder principal, never an Employee.

## D-C4-04 — Employees act on the organization only through governed runs; the Founder alone delegates authority (Technical Lead, C4)

**Decision.** An Employee's organizational act (staffing request, CEO synthesis, delegated staffing
decision and hire, work delegation, cross-Department support request, reprioritization, handoff
refusal / clarification / escalation, Review Plan declaration) is a typed model proposal (`ORG_ACTION`)
executed by the runtime through one fenced write (`recordOrgAct`). The actor is the run's attributed
Employee; each act needs its explicit grant (default deny) AND Position eligibility from the
assignments (Title ≠ Authority: a seat without the grant, or the grant without the seat, is refused);
acts are idempotent per (Work Item, Work-Item-global step) and replayed on resume. Authority is delegated
by the Founder only (`delegateAuthority`: an org capability grant + a delegation record whose limits —
cost, roles, seat kinds, Departments — bind every delegated decision); R2 / R4 and approval authority are
never delegable; an Employee cannot delegate (no self-escalation). Work delegation grants the delegate
nothing, goes down the reporting line only (across Departments it is a support request to the target
Director seat's holder), is bounded (depth 3, fan-out 5 — tunable) and acyclic, and the child is an
ordinary C1 Work Item in the parent's lineage, funded from the delegate's existing envelope and never
above the parent Work Item's cap. A delegator cannot FINAL while a handoff is open: it waits at zero
tokens and is woken by a trigger in the same transaction as the child's end, by an answer, or — closing
the lost-wake window — by the WAIT-settle re-check (which never wakes on its own offer, so it cannot loop
the model). Handoff messages are local governed content shown only to the two parties' governed context.

## D-C4-05 — Independent review: designed before execution, bound to the exact subject (Technical Lead, C4)

**Decision.** A Work Item's Review Plan (domain, applies-to, 1–3 keys with at least one independent
SPECIALIST key, independence rules, rubric, reviewer instructions, review budget, deadline) is declared
before its first run (datastore trigger) and versioned (a new version supersedes; open requests under
the old one go STALE). A review request is bound to a subject fingerprint — the exact output (Work Item,
judged run, content hashes) or the exact action (the approval-scope fingerprint) — so a materially
different output or action is a new review. Reviewer selection decides every eligibility condition in
SQL BEFORE the ranking LIMIT (R1-12 family): ACTIVE Employee, VALID reviewer-role certification, no held
/ retired / corrupt pinned Skill, no Quality Hold, data class, capacity, independence (never the
executor, never the delegation chain, never one reviewer on two keys — also a datastore index). Each
reviewer reviews through its own governed review Work Item; the decision is re-checked at the decision
boundary (eligibility, subject freshness, plan version). One deterministic evaluation: all PASS →
SATISFIED; all FAIL → REWORK; a mix → an explicit Review Conflict (never averaged); UNCERTAIN /
INSUFFICIENT_EVIDENCE / ESCALATE → ESCALATED; NEEDS_SPECIALIST → reassigned to a stronger reviewer.
Conflicts and escalations are resolved by the Founder. R2 executes after a satisfied action review; R3
needs the review AND the Founder approval (review first); a satisfied action review authorizes exactly
one intent; a rejected exact action stays rejected; R4 stays Founder-only and a review request can never
be satisfied for R4 (datastore CHECK). A reviewer's rationale reaches the reworking executor's governed
context (never telemetry). Execute ≠ Review ≠ Approve.

## D-C4-06 — Reviewer qualification is C3 evidence; the Review Pool is not a Department (Technical Lead, C4)

**Decision.** A reviewer is an Employee whose role is the domain's reviewer role, certified by the
Academy (C3 certifies an Employee for its current role, D-C3-24): its clean holdout attempts are its Gold
cases. It enters the domain's Review Pool in CALIBRATION (shadow reviews that never count), earns
calibration evidence (shadow decision vs the authoritative outcome — or, while a domain has no
independent reviewer yet, the Founder's own judgement; counted once per decision), and is promoted to
ACTIVE (independent authority) by the Founder only with Gold cases AND calibration agreement ≥ 80 %;
seniority and titles play no part. Suspension withdraws its open keys; reinstatement returns it to
CALIBRATION (trust is rebuilt, never decreed). The Review Pool is a registry of qualification records
spanning Departments — no Department, seat or reporting line (verifier rule `review-pool-not-department`).
No second certification or Skill-status system: a held / retired pinned Skill already makes the reviewer
ineligible (P-03).

## D-C4-07 — P-07 implemented: a charged-failure deployment is excluded for the same Work Item across runs (Technical Lead, C4)

**Decision (implements D-R1-03).** A deployment that produced a FAILED_CHARGED attempt, or a possibly
billed one (held for a sent-UNKNOWN failure class, USAGE_UNREPORTED or USAGE_UNUSABLE), for a Work Item is
not selected again for that Work Item in any later call, run or job: the router never proposes it and
the reserving transaction refuses it (`ROUTE_NO_LONGER_ELIGIBLE` / `CHARGED_FAILURE_EXCLUDED`),
computed from the durable money records alone (no second accounting state). Only an explicit, evidenced
Founder release lifts it, and a release covers exactly the charged / possibly billed attempts that
existed when it was recorded (a count, not a timestamp: two events in one millisecond can never make a
release cover the future); a later such attempt excludes again. Other Work Items are unaffected.

## D-C4-08 — CI: one stable gate, docs fast path, sharded full proof set with parity, post-merge integrity (Technical Lead, C4; implements D-R1-07)

**Decision.** `.github/workflows/ci.yml` classifies each change (`scripts/ci/classify-changes.mjs`,
self-tested, fail-closed: an empty diff, any non-docs path or any error means FULL). Docs-only changes
run install + build + verifier on Ubuntu (no Windows suite). Every other change runs the FULL proof set
on Windows AND Ubuntu as parallel jobs — static (build, typecheck, lint, verifier), tests (every
workspace test), mutation (each check split into disjoint `--shard i/n` slices), acceptance (C1–C4). The
single required status `quality-gate` (`if: always()`) passes only when every job the mode requires
succeeded AND the shard reports prove that each recorded mutation of every check ran exactly once on each
OS (proof parity: parallelism never deletes coverage). A push to `main` whose merge-commit tree equals
the tree a green PR run recorded (`tested-tree` artifact) takes a fast integrity path (build, typecheck,
verifier, C1 acceptance on both OSes); anything else — no PR, no green run, a different tree, a non-merge
commit, any API or git error — runs the FULL set. `workflow_dispatch` always runs the FULL set (manual
full-main escape hatch). Every action is SHA-pinned; default permissions `contents: read`. The verifier
pins this contract (`ci-contract`, `ci-classifier-fails-closed`). Branch protection / rulesets are
**not** changed by C4 (recommendation only: require `quality-gate`; the Free private plan returns 403 for
the protection API).

## D-C4-09 — Independent Oversight never satisfies or bypasses a gate (Technical Lead, C4)

**Decision.** Oversight (Stage 11 §27–§32) is a separate request kind on a completed output, assigned to
a reviewer independent of the executor AND of the required review's reviewers. A PASS changes nothing; a
FAIL opens an oversight finding (forward-only loop: OPEN → ROOT_CAUSED → CORRECTIVE_ACTION → VERIFIED →
CLOSED) and, where the required review had passed, an explicit Review Conflict for the Founder. Quality
Holds (reviewer / qualification / domain / rubric) are Founder-placed and stop reliance at selection and
at the decision boundary; Skill holds remain C3's own Skill freshness.

## D-C4-10 — C4 health and visibility (Technical Lead, C4)

**Decision.** Health gains a content-free `organization` component (seats, vacancies, acting coverage,
staffing queues, handoffs, delegations; the Review Pool, waiting reviews, conflicts, escalations, holds,
findings). Acting coverage past its end, a review with no eligible reviewer and a review-required output
without a plan need ATTENTION; pending decisions and conflicts DEGRADE. Vacant canonical seats are
reported but change no status: the Founder staffs the skeleton; no identity or headcount is invented.
The read-only CLI gains `organization` and `reviews` (IDs, codes, states, counts only).

## D-C4-11 — Guard evolutions made by C4 (Technical Lead, C4)

**Decision.** (1) The later-scope verifier rule now guards C5 / C6 / C7 (Command Center, Founder ↔ CEO
conversation, dashboards, APP-OPS); C4 owns organization / review / delegation. (2) The budget-writer rule
exempts test files (a real released-schema upgrade proof seeds rows); production writers are unchanged.
(3) The C1 supervisor-verification mutation now removes nine checks (the C4 organization reconciliation is
a supervisor-fenced recovery write too, with its own stale-supervisor proof). (4) New rules:
`c4-proofs-present`, `c4-not-claimed-closed`, `organization-writes-confined`, `c4-telemetry-content-free`,
`r4-never-review-satisfied`, `review-pool-not-department`, `ci-contract`, `ci-classifier-fails-closed`,
each with violation scenarios. (5) R2 is default-deny like every action: a grant is needed before the
review gate (the C2 runtime proof now grants it).

## D-C4-12 — Open Product questions surfaced by C4 (not decided here)

Recorded for the Product Owner; C4 implements the fail-closed reading in each case.
1. **Multi-role reviewers.** C3 certifies only an Employee's current role, so a reviewer holds the
   reviewer role. Should a Specialist also be able to review its domain (a second certified role)?
2. **Bootstrap calibration subjects.** The first reviewer of a domain calibrates on real outputs whose
   counting key it cannot then take (it shadowed them); those outputs wait for a second independent
   reviewer or a Founder decision. Should the Founder be able to decide such an output directly?
3. **Acting-coverage and delegation bounds** (90 days, depth 3, fan-out 5) are engineering defaults; the
   Product Owner may set policy values.
4. **Charter completion.** Baseline charters carry Product-authority mission / scope only; outcomes,
   measures, risks and budget envelopes await Founder versions (`publishCharter`).

## D-C5-01 — C5 lives in two new packages over the existing engine; no second backend (Technical Lead, C5)

**Context.** C5 needs a Founder-facing surface, a browser UI, a Goal model, Founder-facing communication and
Founder Attention. Nothing in the repository had a network listener, a frontend or a Goal.
**Decision.** Two packages join the workspace: `@qandeel-company/command-center` (the loopback Founder
application surface: sessions, explicit capabilities, static files, Server-Sent Events, the proactive CEO
briefing policy, the `qandeel-founder` launcher) and `@qandeel-company/command-center-ui` (the browser UI and
its pure layout / lens model). Goals, communication, attention, sessions, previews and the projection live in
`@qandeel-company/storage` (`goals.ts`, `communications.ts`, `attention.ts`, `founder-auth.ts`,
`founder-actions.ts`, `universe.ts`, migration `0009_c5_founder_surface.sql`), reached through the runtime's
new `founder` admin handle exactly like the C2–C4 handles. The verifier's later-scope regexes were narrowed to
C6 / C7 names; `command-center*` joined `ALLOWED_PACKAGES`.
**Consequence.** The UI never opens SQLite, never holds a `CompanyStore` and never imports the runtime-authority
subpath or the test seam; the surface reaches storage only through the runtime's handles and the exported
stores. One engine, one truth.

## D-C5-02 — UI stack: tsc-only native ES modules and three.js WebGL 2; no bundler, no CDN, no desktop shell (Technical Lead, C5)

**Context.** The Founder host runs Smart App Control. Vite 8 (rolldown, lightningcss), Vite 5–7 (esbuild, Rollup 4)
ship unsigned native binaries that the host blocks — the same failure family L0 recorded for `tar.exe` and system
Git. WebGPU renderers are still moving between releases; SDF text libraries shape Arabic only partially.
**Decision.** The UI is compiled by the repository's TypeScript to ES2022 modules and loaded natively through an
import map; `three@0.186.1` (MIT, pure JavaScript, zero dependencies, no install script) is the one renderer
dependency, allow-listed for the UI package only and served from the workspace's own `node_modules`;
`WebGLRenderer` (WebGL 2) is the primary renderer; the same layout renders as SVG 2.5D when WebGL 2 is
unavailable. Every label, name and number is HTML / SVG text; WebGL draws geometry, light and atmosphere only.
IBM Plex Sans Arabic (OFL) is bundled. No CDN, no remote font, no Electron / Tauri.
**Consequence.** The whole build and runtime path runs on signed binaries (Node 24, Edge / Chrome). The
verifier rule `founder-listener-loopback-only` refuses any remote URL in the UI and any network module outside
the one listener.

## D-C5-03 — The authenticated Founder surface: single-use launch token, hashed sessions, one synchronous scope (Technical Lead, C5)

**Context.** D-C2-13 kept production Founder authority closed until C5 authenticates the human. Stage 14: local
is not trusted; natural language never grants authority; secrets never enter ordinary SQLite.
**Decision.** `qandeel-founder serve` / `launch` (run by the Founder's own Windows user against the workspace it
owns — that file boundary is the trust anchor) mints a 32-byte single-use token whose SHA-256 is stored with a
90-second expiry; the browser redeems it once (the token travels in a URL fragment, never in a request URL or a
log) for a session whose cookie value and CSRF secret are stored only as SHA-256 hashes (8-hour expiry, 2-hour
idle timeout, revoked on server stop). The first redemption of a workspace registers the Founder principal.
`FounderAuthStore.withSession(session, fn)` re-verifies the row and enters `founderSessionInternals.scope`,
which arms the existing chokepoint (`founderAdminWrite`) for the synchronous extent of `fn` only; a returned
promise is refused. The listener binds `127.0.0.1`, allow-lists `Host` / `Origin` / `Sec-Fetch-Site`, requires
the CSRF double submit on every state change, and serves a `default-src 'self'` CSP.
**Consequence.** A Founder ref is still not authentication anywhere; the test seam is untouched and unreachable
in production (`founder-session-scope-confined`). No secret is persisted, so Windows user-scoped protection
(DPAPI) is not required in C5; a device-bound key remains a recorded seam.

## D-C5-04 — The durable Goal model and Goal → Work links (Technical Lead, C5)

**Context.** Stage 2 defines Goal as canonical Direction; no implemented Goal existed. Company goals need Founder
approval; Directors derive Department goals within authority; routine work needs no artificial goal.
**Decision.** `goals` (kind COMPANY / DEPARTMENT, explicit lifecycle DRAFT → PROPOSED → APPROVED → ACTIVE →
PAUSED / ACHIEVED / CANCELLED / SUPERSEDED, owner, parent derivation, horizon, Founder approver), append-only
`goal_history`, and `goal_work_links` (SERVES / DERIVED; ended, never deleted). A COMPANY goal cannot be
APPROVED / ACTIVE without a `founder:*` approver (CHECK); a DEPARTMENT goal derives only from an APPROVED /
ACTIVE company goal (trigger + code). Founder acts go through the chokepoint; a Director derives or links only
from inside its governed run through the new `GOAL_ACTION` proposal (`recordGoalAct`, fenced, seat-checked,
idempotent per employee / parent / title).
**Consequence.** Goal Focus is data-backed: `Goal → owner → Departments → Work Items → Employees → reviews /
approvals` comes from rows. No parallel Work Item engine; no C6 outcome analytics.

## D-C5-05 — Founder-facing communication: structured threads, Employee replies only from their own governed run (Technical Lead, C5)

**Context.** Stage 9: structured, targeted, context-linked communication; Message ≠ Decision; direct communication
changes no authority; the Founder Communication Standard for briefs. C3: no ungoverned model call.
**Decision.** `communication_threads` (FOUNDER_CEO / FOUNDER_EMPLOYEE / CEO_BRIEF, FOUNDER_ONLY scope, optional
context) and append-only `communication_messages` (purpose, attention level, body + hash, `brief_json` for the
standard, `reply_work_item_id`, `run_id`). A Founder message that needs an answer creates, in the same
transaction, a `c2.employee-task` Work Item owned by the Employee, funded from its envelope and released (the
queue trigger wakes the runtime); the thread binding lives in the item's immutable processor input. The
Employee's run answers with the new `MESSAGE` proposal, recorded by `recordMessage` (fenced): the sender is the
attributed Employee, the thread must be the item's, a BRIEF must carry its four answers, duplicates replay. A
CEO brief is a system-requested run of the CEO seat holder (one open run per context).
**Consequence.** Conversation ≠ authority (no grant, approval or budget path exists from a message); message
bodies are company content under a Stage 9 scope and never enter audit / events / logs (Rule A, verifier rule
`c5-telemetry-content-free`). `handoff_messages` stay C4's delegation records.

## D-C5-06 — Founder Attention as durable dedup / cooldown state over canonical sources (Technical Lead, C5)

**Context.** Stage 9 §16, §25–§29: attention is reserved for R3/R4 approvals, decisions, risk, conflict, strategy;
no storm; silence is never approval.
**Decision.** `founder_attention_items` keyed by a dedup key per source (pending R1/R3 approvals, RECOMMENDED
staffing, ESCALATED handoffs, OPEN review conflicts, PROPOSED company goals, CEO briefs, unanswered decision
requests / escalations / blockers, Founder-participant threads whose latest message warrants attention).
`AttentionStore.sync` reconciles idempotently after a durable change signal (never on a timer): open, re-signal
(4-hour cooldown), resolve with the source, keep a Founder dismissal until the source changes. Routine
completions and FYIs never enter. Lanes: NEEDS_ME, CEO_BRIEFS, THREADS.
**Consequence.** The Founder's first frame answers "does anything need me?" from state, not from notifications;
items carry IDs and codes only.

## D-C5-07 — Governed action previews: natural language never mutates; confirmation is an explicit, fingerprinted act (Technical Lead, C5)

**Context.** Stage 14 D14-A.6; C5 brief §11.3 / §15: read commands may change focus; mutating intents need a
structured governed preview and explicit Founder confirmation; no "LLM has full control of UI" agent.
**Decision.** `classifyFounderIntent` is a closed deterministic grammar (Arabic / English) returning READ, MUTATING
or UNKNOWN — never "execute". A mutating intent that resolves to one concrete target becomes a
`founder_action_previews` row (validated payload of IDs / codes / bounded numbers, fingerprint, 10-minute
expiry, bound to the session). `confirm` requires the same session, the exact fingerprint and a live preview,
then calls the real boundary (`decideApproval`, `GoalStore`, `decideStaffingRequest`, `resolveConflict`,
`changeBudgetCap`, `delegateAuthority`) inside the session scope and records the result on the preview. R4 and R2
approvals are never previewable.
**Consequence.** Scenario E holds by construction: the text alone changes nothing; the mutation check
`c5-text-mutates-without-confirmation` proves the gate is not vacuous.

## D-C5-08 — The Company Universe projection is derived, deterministic and time-correct (Technical Lead, C5)

**Decision.** `projectUniverse(store, { at? })` in storage builds the one read model the UI renders: canonical
sector order, seats with holders at T from effective-dated assignments (PRIMARY / ACTING / vacant), employees
with their chain inward to the Founder, live work, typed live relations only (DELEGATION / SUPPORT / HANDOFF /
ESCALATION / REVIEW / APPROVAL), goals with anchors and links, open attention, content-free signal counts.
Historical instants read the append-only history tables, never current rows. Arrays are sorted by stable IDs.
**Consequence.** It is never written back and never canonical; C6 extends it behind a separate read model.

## D-C5-09 — Attention Orbits layout: rank = radius, Department = sector, seats own their angle (Technical Lead, C5)

**Decision.** A pure module (`packages/command-center-ui/src/model/layout.ts`) places the Founder at the centre,
the CEO orbit at 2.6, Directors 5.4, Managers / Leads 8.2, Specialists 11, goals as beacons at 14.2 at the mean
angle of their anchor Departments, attention items at 1.35 inside the CEO orbit; five equal Department sectors
in canonical order with a narrow company gap at the top for company-scoped seats; a seat's angle comes from its
kind, ordinal and a stable hash of its code (a transfer moves the person, a vacancy keeps its place; no random
layout ever). Depth (y) also expresses rank. When one Department holds more seats of a rank than its arc can carry
at a minimum spacing of 1.15 units, the group overflows onto concentric sub-rings (ordinal modulo the ring count,
0.85 units apart) instead of crowding one arc. Goals with no anchored work are spread by their own ordinal at the
top. Edges are drawn only from live relations. Lenses map to emphasis weights; labels follow a distance tier, and
attention captions appear only in the Attention lens, when near, or when selected (the rail carries the words).
**Consequence.** Stable spatial memory and no spaghetti at 60+ employees are proven by tests
(`attention-orbits-layout`) and by the mutations `c5-rank-radius-inverted` / `c5-department-sector-collapsed`.

## D-C5-10 — Two motion layers, reduced motion as a parity mode (Technical Lead, C5)

**Decision.** Ambient life (nebula drift, dust motes, sector-field breathing, Founder halo, pointer parallax) is
neutral in colour, without direction between entities, never triggered by data, and removed in reduced motion.
Semantic motion (camera focus / return, an edge pulse when a relation appears, an attention item gliding inward
when new, the selection ring) starts and ends at real entities and is listed in the activity strip; in reduced
motion it becomes cuts and static badges. Reduced motion is a separate mode (system preference or toggle),
never a downgrade of the default.
**Consequence.** A user cannot mistake ambient motion for a company event; the same meaning survives without
motion (spike check `spike-reduced-motion-parity`).

## D-C5-11 — The one network path, CI and verifier evolutions made by C5 (Technical Lead, C5)

**Decision.** (1) `no-network-in-runtime-code` exempts exactly `packages/command-center/src/server/listener.ts`
and the browser UI; the new rule `founder-listener-loopback-only` requires the loopback constant, refuses a
wildcard bind, refuses network modules elsewhere in the surface package and refuses remote URLs / Node
modules in the UI. (2) `runtime-dependencies-allowlisted` accepts `three` for the UI package only. (3) New
rules `c5-proofs-present`, `c5-not-claimed-closed` (C6 / R2 / C7 not before C5 closes),
`founder-session-scope-confined`, `c5-telemetry-content-free`, each with violation scenarios. (4) CI: the C5
tests run inside the existing `tests` job; `c5:acceptance` and the browser smoke (`c5:spike`, headless Chrome /
Edge through CDP, zero dependencies) join the `acceptance` job; `c5:mutation` shards join the matrix on both
operating systems; the quality gate's parity covers `c5`. Nothing was removed and no `continue-on-error` was
added.

## D-C5-12 — Open Product questions surfaced by C5 (not decided here)

Recorded for the Product Owner; C5 implements the fail-closed reading in each case.
1. **Stage 16 authority.** The Founder Command Center source artifact is still missing; this candidate follows
   the C5 task brief where Stage 16 would have supplied Product detail. The brief's contents are the only
   Product source for lenses, attention lanes and the confirmation boundary.
2. **Content exposure in the Founder projection.** The Founder sees company content (names, objectives,
   message bodies, goal text) in the UI; telemetry stays content-free. Whether any category should be hidden
   from the Founder surface (for example reviewer rationale) is a Product decision; C5 shows work objectives,
   goal text and messages, not reviewer rationale or staffing evidence.
3. **Budget ceilings from natural language.** A stated ceiling maps to the Employee envelope cap in the
   envelope's currency; a different currency is refused (`CURRENCY_MISMATCH`). Whether the Founder may state
   ceilings in another currency with a conversion policy is open.
4. **Attention cooldown / session TTLs** (4 h, 8 h / 2 h idle, 90 s launch, 10 min preview) are engineering
   defaults; the Product Owner may set policy values.
5. **Engineering Department goal derivation** is available to any Director seat holder; whether Stage 10's
   "Engineering becomes a formal Department later" limits it is a Product reading.


## D-C5-13 — Presentation correction: English application with content as written; the map names its own ranks and Departments (Technical Lead, C5)

**Context.** The Founder's comprehensive visual UX correction on the C5 candidate (same branch, same Draft PR):
the application must be English and left-to-right while the Founder may write to the CEO and any Employee in
Arabic or English; rank must be read from the orbit and Department from the sector without a click; the map,
not a dashboard, is the product; goals must feel like strategic anchors; the conversation must be an operating
ledger; the background must be premium, not a starfield.

**Decision.** (1) The interface language is English (`lang="en" dir="ltr"`); every code family has one wording
table in `packages/command-center-ui/src/model/format.ts`, an unknown code is spelled into words, and no
identifier reaches the Founder as a code. Company content keeps its own script and direction per block
(`dirOf`), never the layout around it. (2) The orbits carry their own names (one tag per ring on a sector
boundary) and every sector carries a named, coloured rim arc with its head-count that opens the Department; the
five Department hues are the dataviz-validated set `#3987e5 #199e70 #c98500 #9085e9 #d95926` (adjacent pairs
around the ring ΔE ≥ 8.4 under CVD). (3) Panels open on demand and recede: the attention rail from a top-bar
control or a lens, the time control on hover / in Historical Focus, activity as a transient note. (4) D-C5-09 is
amended: anchored goals stand `GOAL_LEAD = 0.25` rad clockwise of their Departments' mean angle and are tethered
to each anchored Department's rim; ring radii are 2.6 / 5.3 / 8.0 / 10.7 with the rim at 12.1 and goals at 13.4.
(5) The seed and the proofs speak the same language as the product: people, seats, goals and work are seeded in
English, the Founder ↔ CEO conversation is bilingual on purpose (the Arabic question and answer are the proof that
content renders as written). (6) Nothing below the presentation changed: no storage, runtime, governance or
authentication file, and migration 0009 is untouched.

**Consequences.** The command grammar was already bilingual; the acceptance drives the governed action in
English and the read command in Arabic. The spike checks replaced "Arabic labels" with "English chrome, content as
written, ring and sector names present". The visual proof gained a conversation frame, a real scale frame and a
before/after board. The Founder-facing Arabic register guidance (D-C5-10's sibawayh notes) now applies to content
only.


## D-C5-14 — Presentation reset: the Tree of Light replaces the orbital surface as the Founder's home (Technical Lead, C5)

**Context.** The Founder rejected the orbital / galaxy presentation as the primary company view (it read as a
graph in space, not a company) and selected the Tree of Light direction from the concept renders: Founder at the
top, CEO beneath, five Department columns below, goals along the bottom, gold execution lines from work to goals.
The reset is presentation-led on the same branch and Draft PR; the C5 runtime, authentication, Goal semantics,
attention behaviour, communication, governed actions and history are preserved.

**Decision.** (1) The home is a structured executive surface in DOM + SVG: a leadership spine (Founder emblem,
attention chips beside it, one gold trunk to the CEO card), one column per Department in canonical order (name,
accent, head-count, the Director first, then Managers / Leads, then Specialists; vacant seats keep their row;
acting cover is its own node beside the person's own seat), and a strategic-direction band pinned to the bottom of
the view holding the goals as mission objects. (2) Every line is a durable fact: reporting lines from the seat
chain, execution lines from Goal → Work links (one per column and goal, weighted by the people serving), live
typed relations drawn only on focus surfaces. (3) D-C5-02's `three` exception is retired: the UI has no
dependency, the static server serves no vendor route, and there is no fallback renderer because there is nothing
to fall back from. (4) D-C5-09 (Attention Orbits layout) and the orbit parts of D-C5-10 are superseded; the two
motion layers survive as: ambient = one slow drift of the surface light; semantic = focus scroll, lit paths,
relation pulse, arriving attention, flow along a running execution line; reduced motion keeps every mark.
(5) The light executive theme is the committed world (warm paper, ink, one gold, five validated Department
accents); the interface stays English with content as written (D-C5-13). (6) The mutation gates over the layout
become `c5-rank-order-flattened` and `c5-department-column-collapsed`; the proof marker is
`C5-PROOF: tree-of-light-layout`.

**Consequences.** The Windows CI smoke no longer needs a GPU or software WebGL and is bounded to eight minutes.
The proof's settle drives frames because a background headless tab advances its animation clock only when it
paints. The concept renders that informed the choice (constellation, strategy flow, tree of light, board) are
recorded in the report; the flow and relationship strengths live on inside Goal Focus and Employee Focus.


## D-C5-15 — Final visual craft pass: the Tree of Light is frozen; one line system, docked context sheets, an attention surface beside the Founder (Technical Lead, C5)

**Context.** The Founder accepted the Tree of Light as the final visual foundation and asked for one bounded
craft pass (QANDEEL_COMPANY_C5_TREE_OF_LIGHT_FINAL_VISUAL_CRAFT_PASS_v1): Company Live polish, integrated
Employee and Goal Focus, an operating conversation, a Founder Attention that stays with the Founder, better
execution lines and goal objects, no structural change, no runtime change.

**Decision.** (1) The line layer is one system drawn from facts only, in two layers: structure (trunk with halo,
an orthogonal gold bus from the CEO into every column, the team lane in the Department's accent, live relations)
under the cards; execution (one collector rail per goal above the strategic direction that every serving column
drops into, one bundle into the goal, the dashed derivation beneath the goal objects, the tether) above the
pinned band with a paper casing. (2) Status lives on the person (a dot at the avatar's corner, a ring while work
runs); the Department lives in the column (accent, header, lane) and on the avatar tint; tags appear only when
they say something. (3) Context sheets (person, goal, conversation) dock beside the company, stop above the
strategic direction, sit on the side that keeps their subject visible and are tethered to it; they share the
columns' avatars, accents, radii and status grammar. (4) The conversation is an operating ledger: identity with
reporting line, the work carried now and its goals, dated entries with sender, purpose and time, briefs as
executive memos, the newest exchange kept in view, a composer addressed to the person; never bubbles.
(5) Founder Attention idles as compact chips beside the Founder and opens as a surface anchored over them; reading
an item spotlights where it lives in the company through a pure `attentionSpotlight` emphasis (a view concern
that survives live refreshes; attention semantics untouched). (6) No tracked uppercase labels; sentence case,
one scale; Arabic never letter-spaced. (7) The visual direction is frozen after this pass unless a BLOCKER is
found.

**Consequences.** The proof harness gained the spotlight, tether and "sheet clear of the goal band" checks, close-
ups, a Founder ↔ Employee Arabic conversation, and two findings recorded for later harness work: the DevTools
Animation domain must not be enabled on this page (it slows every interaction five to thirty times with this many
transitioning elements; the rAF-driven settle suffices), and a clipped or scaled capture leaves the headless
compositor at that size until the device metrics are set again. Runtime, storage, governance and authentication
are unchanged; C5 remains NOT CLOSED pending exact-head CI, review and merge by the Technical Lead.

**Addendum (final MINOR visual residual correction, on `d833a8c1`).** Two collisions from the frozen
presentation were corrected without reopening it (report §23): the tether is a leader that keeps to its
subject's row and the column gutters, leaves a goal from its top edge at the nearest gutter, and passes beneath
any card, head, goal or chip it crosses (drawn in the under-layer; `splitLeader`, with a pure proof); the CEO's
sheet docks on the empty left desk, and a right-docked sheet that would meet the "Needs you" chips starts
beneath them (`--desk-b`, measured live). The walkthrough stays at 4 fps (proof-only MINOR: each headless
capture is a ~160 ms software paint). The proof gained `--minimal`, leader-crossing and chips-clear checks.

## D-C5-16 — The line layer is sized from layout rects, rounded down, never from the scroll extent it creates; the browser harness fails bounded and reads the runner's motion preference (Technical Lead, C5)

**Context.** Windows CI hung twice in the C5 browser smoke until the step's 8-minute ceiling. Three bounded
corrections followed, each from an exact head the Founder named (report §24). The harness could wait forever
on an unanswered DevTools command; the reduced-motion smoke assumed the runner starts in `full` motion; and,
once the harness could fail with a name, reproducing the runner locally proved a defect in the Product: the
Tree of Light's line layer (`TreeView.#drawLines`) derived its height from the company's `scrollHeight`, of
which the layer itself is the largest part, so every redraw grew it by one goal band (1 073 → 30 245 px in
sixteen seconds) until the browser crawled. The Founder authorized the Product fix in that scope only.

**Decision.** (1) The line layer's size is read from layout rects alone: the company box and the goal band it
must cover, the union's edge rounded once and **down** (`floor(max(company.height, band.bottom − company.top))`,
`floor(company.width)`). Never from `scrollHeight` / `scrollWidth`, which the layer feeds; never rounded up,
because a layer a fraction of a pixel past the boxes it covers opens the surface's scrollbars, which shrink the
company, which redraws the layer smaller, which closes them: an endless redraw at frame rate. The layer paints
with `overflow: visible`, so its size clips nothing; it may only never create scroll extent. (2) Every DevTools
command the harness sends is bounded (`QANDEEL_CDP_TIMEOUT_MS`, default 20 s) and an unanswered one fails
naming the method, the helper and the step, with the pending map cleared and a bounded post-mortem; the CI
step's ceiling is the emergency stop, never the diagnosis. (3) The smoke reads the two motion layers (the OS
preference and the application mode) instead of assuming either, drives the real toggle only when needed, and
restores what it found. (4) `spike-line-layer-bounded` is a permanent regression proof: selection, return and
twenty forced redraws leave the layer, both scroll extents and the visible surface unchanged.

**Consequences.** The Windows selection step (47 s) and the 8-minute hangs had one cause in the Product, not
in the runner; the surface no longer degrades with live refreshes on any host. No layout semantics, visual
design or motion behaviour changed. Runtime, storage, governance, authentication, CSS and `main.ts` untouched;
the quality gate and the Windows leg unchanged. C5 remains NOT CLOSED pending exact-head CI, review and merge by
the Technical Lead.

**Addendum (the harness renders without a GPU process).** The exact-head run on the line-layer fix left the
Windows leg red for a second, distinct cause, which a harness-only diagnostic commit then named from the runner
itself (report §24.7): every step records the timing of each helper call, the browser's product and GPU
backend are recorded at start, and an unanswered command reports the process tree and the browser's log tail.
The Windows post-mortem showed the SwiftShader GPU process at 137.7 CPU-seconds in thirty seconds against a
renderer at 13.5, the browser blocked behind it. Decision: the harness launches the browser with
`--disable-gpu` (software compositing, CPU raster) — the surface is DOM + SVG and the walkthrough encoder a 2D
canvas with WebCodecs, so no GPU is needed anywhere; the SwiftShader flags were a WebGL-era leftover.
`QANDEEL_BROWSER_GPU=swiftshader` restores the old path for comparison. The browser log also surfaced a MINOR
Product residual, recorded and not changed: the context sheets set the Department tint through a `style`
attribute that the surface's own CSP blocks.

## D-C5-17 — The Founder change-signalling contract: reads are silent, failures are silent, a successful mutation announces once, attention reconciliation announces only a delta (Technical Lead, C5; authorized by the Founder)

**Context.** With the harness bounded and GPU-less, the Windows runner's own log named the remaining cause of
its red smoke: the context sheet rebuilt every ≈35 ms after a selection. On the Founder's host the real
surface went from 0 requests in 4 s idle to 605 in 4 s after one CEO selection and 720 in 4 s after the
return, indefinitely (report §25). `CompanyRuntime.founder` wrapped its four stores in a generic Proxy whose
`finally { wake() }` signalled the dispatcher and announced "the Founder's world changed" after every call —
reads, failures and zero-delta attention reconciliation included — while the surface refreshes on that
announcement with Founder reads: a closed loop at API latency, invisible on a fast host, fatal on the runner.

**Decision.** (1) A Founder change announcement means *durable Founder-visible state materially changed*:
announced, and the dispatcher woken, only after a successful mutation, once. (2) Reads announce nothing and
wake nothing; a call that throws announces nothing; `attention.sync` announces only when it opened, signalled
or resolved an item; `founder.universe` stays a pure projection. (3) No generic "every method is a write"
proxy: `signalling` builds each capability from an explicit classification of every public method (goals:
`propose`, `transition`, `linkWork`, `unlinkWork` mutate; communications: `openThread`, `directThread`, `send`,
`requestCeoBrief`, `closeThread`; attention: `dismiss`, with `sync` conditional; actions: `preview`, `confirm`,
`reject`, `expireStale`; everything else reads) and refuses at construction a method that is unclassified or a
classified name that no longer exists. (4) No UI debounce or coalescing: the producer's contract is the fix;
a masked producer would hide the next real event bug and add latency. (5) An explicit user mutation that is
internally a replay may still announce once, bounded (no redesign of idempotent user commands for C5).

**Consequences.** Five runtime proofs meter `onFounderChange` and `wakeSignals` (reads 0/0; failed writes 0/0
with errors preserved; a mutation exactly 1/1 after the durable write; stable reconciliation 0, a real delta
1 then silence; the method census exact and frozen); two `c5:mutation` gates (reads announcing, zero-delta
sync announcing); the browser smoke proves the real surface idle after a selection and return (0 API
requests in 3 s, at most one refresh cycle allowed). Store transactions, the auth/security model, migration
0009, attention and goal semantics, the Tree of Light, layout and motion are unchanged. C5 remains NOT CLOSED
pending exact-head CI, review and merge by the Technical Lead.

## D-C6-01 — C6 extends the C1–C5 mechanisms; new durable concepts only where none existed (Technical Lead, C6)

**Context.** The C6 brief requires evaluation, attribution, learning closure, reporting and resilience without
parallel systems. The census (report §3) found the lesson lifecycle, Academy holdouts, Review Pool calibration,
quality holds, the usage ledger, Goals, Founder Attention, the C5 signalling contract, backup and runtime
recovery real — and three genuine gaps: nothing reached `OUTCOME_VERIFIED`, no record held verification
evidence, and backups were same-device, database-only, unencrypted and unretained.

**Decision.** Pure kernel in `@qandeel-company/mind` (`evaluation`, `performance`, `improvement`, `reporting`);
persistence in `@qandeel-company/storage` (`improvement`, `improvement-core`, `resilience`, `maintenance`,
`update-hold`) with migration `0010_c6_improvement_engine.sql`; runtime access through `founder.improvement`
and four resilience methods; the Founder API and command channel extended with reads. New tables only for new
concepts: the Eval Registry and its calibration runs, outcome verifications, evaluation results, causal
attributions (+ history), learning signals (a companion that classifies C3 observations — the lesson lifecycle
stays C3's), learning interventions (+ history), systemic findings (+ history), failure cases (+ history),
report snapshots, backup retirements, portable backups, restore drills, maintenance records. Two C6 triggers
guard the existing C3 `lessons` / `lesson_promotions` tables (0005 is untouched). No second Work Item engine,
Goal model, review system, learning store, cost ledger, recovery scheduler or notification bus.

**Consequences.** Every table is STRICT, append-only or forward-only with history, content-free in audit, and
documented in the report's schema table (source of truth, writer authority, reader scope, lifecycle,
idempotency, retention, privacy class).

## D-C6-02 — Completion is not success: the governed outcome verification (Technical Lead, C6)

**Decision.** `ImprovementStore.verifyOutcome` (Founder, through the existing chokepoint) records a verdict
(`ACHIEVED` / `NOT_ACHIEVED` / `INCONCLUSIVE`) with evidence classes and references and performs the existing
Work Item transition (`REVIEWED → OUTCOME_VERIFIED` with `ACHIEVED`, `REVIEWED → CLOSED` with `NOT_ACHIEVED`).
A verification needs a reviewed Work Item (code and trigger); `EXTERNAL_OUTCOME` evidence is refused until a
governed source exists (C7). A qualified outcome = independently reviewed AND verified achieved (kernel and a
database trigger). Qualified reviewers verifying outcomes is a later extension (residual R-C6-04).
**Superseded in part by D-C6-10 (C6-R1):** the Founder's verification stays as the exception / override path;
ordinary outcome verification no longer needs the Founder where the Work Item's Review Plan delegates judgment.

## D-C6-03 — Evaluation, attribution and the Performance Profile (Technical Lead, C6)

**Decision.** The Eval Registry owns evaluation semantics; a definition is ACTIVE only after the evaluator passes
its own calibration over five reference-case kinds (known-good, known-bad, ambiguous, non-employee cause, valid
creative path); `MODEL_GRADER` is a registrable seam with no executable grader (fails closed). The reference
evaluator reads durable evidence only; activity is observability. Causal attribution is proposed from the
run's own recorded failure classification (a billed failed call is cost, never by itself a provider cause —
found by the C6 acceptance, §7 of the report) and validated independently of the subject Employee. The profile
has eight dimensions with sample, confidence, qualitative level and trend, capability and regression lists,
cost per qualified outcome and a readiness *signal*; no aggregate score exists in code or schema (verifier rule
`c6-no-universal-score`). Minimum-sample defaults (3 per dimension, 3 per trend half, 90-day window) are
conservative Strong-v1 values, calibratable in the Pilot.

## D-C6-04 — Learning closure: reflection is a hypothesis; effects are judged on later evidence (Technical Lead, C6)

**Decision.** An Employee-originated observation is a REFLECTION; a mistake lesson is validated only on a
VALIDATED attribution that makes the Employee accountable, a successful pattern only on a qualified evaluation,
a reflected near miss only on a validated attribution (code gate in `validateLesson` + trigger). A successful
pattern is shared beyond its author only after two verified reuses. Interventions follow validated lessons;
their effect is NOT_YET_TESTED until later comparable evidence (IMPROVEMENT_OBSERVED needs two qualified,
recurrence-free follow-ups); one retraining at a time; two ineffective cycles escalate to a systemic finding
(RETRAINING_EXHAUSTED) instead of a third. Repeated validated causes (≥3, and ≥2 distinct Employees for
employee-judgement causes) become systemic candidates (double-loop). Failure → regression / Gold cases bind to
Academy scenarios; a hidden case binds only to a HOLDOUT and is never retraining material.

## D-C6-05 — Reports with typed claims; exception-first attention (Technical Lead, C6)

**Decision.** Reports are composed from facts into claims (`FACT` / `ASSESSMENT` / `TREND` / `RECOMMENDATION`);
every judgement must cite evidence and carry uncertainty (`assertClaim` refuses otherwise); claim parameters
never carry a score or rank. Snapshots are idempotent per (cadence, period end, claims hash). Only material
exceptions (a systemic candidate awaiting the Founder, a failed restore drill, an off-device package missing its
failure domain or objective, a rolled-back update) join the existing Founder Attention collector as
`DECISION_REQUEST` sources — no new attention source kind and no rebuild of the C5 table. The Tree of Light is
unchanged; reports are reachable through the API, the command palette's read intents (`SHOW_REPORT`,
`SHOW_PERFORMANCE`) and the CLI (a report panel in the Tree of Light is residual R-C6-02).

## D-C6-06 — Resilience: portable encrypted packages, honest failure domains, retention, update safety (Technical Lead, C6)

**Decision.** A portable package = the C1 application-consistent snapshot + its manifest + every READY artifact
object + a re-key list, in a length-indexed container (no external archiver), sealed with AES-256-GCM under a
scrypt key derived from an operator passphrase that is never stored; it is written to a destination outside the
workspace, read back and opened before it is recorded. `DirectoryDestination` labels the failure domain
honestly (`SAME_VOLUME` never satisfies the off-device objective; `ATTESTED_OFF_DEVICE` is the operator's
statement). Recovery objectives are set per criticality class (Critical / Important / Rebuildable) as
Pilot-calibrated defaults. Retention is GFS and the database refuses to retire the last generation.
Clean-environment restore revokes the lost device's sessions and reports credential references to re-key; the
runtime's existing startup recovery keeps uncertain effects held. Schema updates run Preflight → Backup →
Rehearse → Migrate → Verify → Activate; any failure restores the compatible snapshot and places `UPDATE_HOLD`,
which `CompanyStore.open` refuses until the operator clears it. DPAPI is not used (source code may not spawn
processes; the passphrase is the portable trust anchor by design, D15-B.4).

## D-C6-07 — The Improvement capability under the C5 change-signalling contract (Technical Lead, C6)

**Decision.** `founder.improvement` is built by `signalling` with an explicit classification: 11 Founder
decisions announce once after success; 18 reads are silent; `evaluate`, `assessIntervention`, `generateReport`
announce only when they recorded something new and `planIntervention` only when it planned or escalated.
Proven by `c6-runtime` tests and two `c6:mutation` gates; the C5 census and signalling proofs are unchanged.
C6-R1 (D-C6-10) adds `completeReviewedTraining` (announces once), the `judgments` read (silent), and two
derivations that announce only on news (`requestLearningReview` when it drew a judge or recorded a candidate,
`planReviewedIntervention` like `planIntervention`): 37 classified methods.

## D-C6-08 — C6 CI, verifier and proof parity (Technical Lead, C6)

**Decision.** `c6:mutation` (40 semantic mutations, D-C6-09 and the eleven C6-R1 gates of D-C6-10 included) joins the mutation matrix on both operating systems
(Windows two shards, Ubuntu one) and the quality gate's parity set; `c6:acceptance` joins the acceptance job on
both operating systems; the verifier adds `c6-proofs-present`, `c6-not-claimed-closed`, `c6-no-universal-score`,
`c6-telemetry-content-free`, `c6-recovery-secret-never-stored` and `c6-external-outcomes-unavailable`, each
self-tested, and now also pins the two C5 signalling mutations that were recorded in the script but not pinned.
No job removed, no timeout raised, no `continue-on-error`. The C5 closure record was written at the C6 start
from GitHub truth (PR #10, runs #81 / #82); C5 is CLOSED / MERGED / CANONICAL.

## D-C6-09 — Systemic-finding provenance and System Contribution credit (Technical Lead, C6)

**Context.** Review finding #9: systemic findings carried no provenance, so the System Contribution dimension
of an Employee's growth could never credit an Employee who discovered a problem in the system. The Product
Owner directed a fix before the PR instead of a residual.

**Decision.** No parallel mechanism: the existing C3 observation → C6 learning-signal classification gains the
fourth learning output the kernel already named, `SYSTEMIC_PROBLEM`. Classifying a work-derived observation that
way records a systemic candidate (origin `REPORTED_OBSERVATION`) only on independent evidence — a VALIDATED
attribution of that work whose PRIMARY cause is the system; an Employee-judgement cause is refused
(`CAUSE_IS_THE_EMPLOYEE`) and the classification rolls back. The finding keeps `source_signal_id` and names
`contributor_employee_id` only when the observation is the Employee's own REFLECTION, and then exactly its
author; system-detected findings (`REPEATED_ATTRIBUTION`, `RETRAINING_EXHAUSTED`) and evaluator / gate /
reviewer-derived observations credit nobody. Provenance is fixed at creation (a later report of the same
problem credits nobody new) and guarded by CHECKs and triggers. The credit enters the profile's
`SYSTEM_CONTRIBUTION` only once the Founder has VALIDATED (or ADDRESSED) the finding; it grants no authority
(the contributor cannot decide the finding; no role, grant, budget, approval, seat, hold or certification
changes). A `SYSTEMIC_PROBLEM` observation is never validated as a lesson about the Employee. Migration 0010 is
amended and re-pinned rather than followed by an 0011 because it has never been released (it exists only on
the unmerged C6 branch). Proven by kernel and storage proofs and the `c6-systemic-credit-misattributed` and
`c6-systemic-credit-before-validation` mutations.

## D-C6-10 — C6-R1: operational judgment delegated through the Review Pool; execution authority unchanged (Technical Lead, C6-R1)

**Context.** Exact-head review of PR #11 (C6-R1 brief, Product Owner): C6 separated Completed ≠ Reviewed ≠
Outcome Verified correctly, but outcome verification, attribution validation, lesson validation and ordinary
retraining were effectively Founder-only, which makes the Founder an operational bottleneck. The correction must
not widen any Employee's execution authority, spending, approvals, budgets, tools, routing or policy.

**Decision.** *Operational judgment is delegated by evidence, qualification, review policy and risk; execution
authority remains separately governed.* No second verifier system — the C4 Review Plan, Review Pool, fenced
review decision and pre-authorized review budget carry it:
- **Policy.** Stage 11 §1 ("a Review Plan may specify outcome verification"): the plan gains
  `operationalJudgment` = `FOUNDER` (default, the previous behaviour) or `REVIEW_POOL`. A plan with a FOUNDER key
  keeps Founder judgment (kernel + trigger); R4 is always Founder-only (`judgmentRoute`). A new 0010 column on the
  0008 table, frozen per plan version.
- **Outcome verification.** A counting reviewer may attach its own cited outcome judgment (verdict + evidence
  classes; `EXTERNAL_OUTCOME` refused until C7) to its review decision. When the plan delegates judgment and the
  keys themselves SATISFY the output review, the same transaction records the verification (`verifier_kind =
  REVIEW_POOL`, the review request and every decision as evidence): all keys ACHIEVED → `OUTCOME_VERIFIED`; all
  NOT_ACHIEVED → `CLOSED`; any key without a judgment → nothing is verified; INCONCLUSIVE or a disagreement →
  `INCONCLUSIVE`, never averaged, surfaced in Founder Attention. A Founder resolution of a conflict / escalation
  leaves the outcome to the Founder. Independence, qualification, the MANAGER key's qualification and subject
  freshness are the C4 ones, re-checked at the decision boundary.
- **Attribution and learning.** An attribution proposal, and a classified work-derived observation put up for
  review (`requestLearningReview`: a lesson candidate UNDER_REVIEW on the independent path), each get ONE judge
  drawn from the plan's Review Pool domain by the same eligibility SQL (`eligibleReviewers`), excluding the
  executor, its delegation chain, the subject Employee and earlier judges. The judge acts from its own governed
  Work Item funded from the plan's pre-authorized review budget and decides through the same fenced
  REVIEW_DECISION: PASS validates, FAIL rejects, any uncertainty escalates to the Founder (Attention), never
  re-drawn. A lesson still passes the C6 evidence gate: its judge is drawn only once the independent evidence
  exists (a validated cause or a qualified evaluation wakes it); evidence that refuses the lesson escalates. Eligibility is re-checked at the
  decision; a judge whose work ended undecided is replaced; a subject that found no eligible judge is picked up
  when pool capacity returns (the C4 refill and the recovery sweep — no polling). Datastore triggers refuse a
  judge who is unqualified, the executor or the subject, a judgment of R4 work, and any Employee name on a
  decided attribution / lesson that is not its assigned judge.
- **Retraining.** A lesson validated on the independent path may be retrained without the Founder
  (`planReviewedIntervention`, `completeReviewedTraining`): an intervention record inside the Employee's
  existing envelope, completed only on objective evidence (a retrained Academy remediation, or the lesson
  delivered to the Employee's own Personal Lesson memory). Training completed is still not improvement.
- **Unchanged.** Company / team / Department knowledge promotion, systemic-finding decisions, failure cases, the
  Eval Registry, grants, budgets, approvals, R3 approval before execution and R4 sovereignty stay where they were
  (grants and approval decisions are `founder:*` in the datastore). A judgment changes its subject's judgment
  state only.

**Consequences.** The ordinary loop runs with the Founder surface disarmed (storage proof and acceptance), and an
authority / spend fingerprint (grants, budget caps, approvals, route / model / tool policy, seats, delegations,
qualifications, certifications) is unchanged across it; new budgets are only review / judgment Work Item
allocations within the plan's review budget. Eleven `c6r1-*` mutations guard the family. Migration 0010 is
amended and re-pinned (never released). Residual R-C6-04 is closed. Systemic-finding diagnosis stays a Founder
decision in this correction (the brief permits pool diagnosis; not needed for the ordinary loop), and no
deterministic outcome verifier is added (no machine-verifiable outcome criteria source exists before C7).

## D-R2-01 — R2 remediation shape: one frozen register, one wave, one migration (Technical Lead, R2)

**Context.** R2 (the Full Strong-v1 Independent Review) froze its findings register before any fix
(`docs/R2_FULL_STRONG_V1_INDEPENDENT_REVIEW_REPORT.md` §8: 1 BLOCKER, 34 MAJOR, 48 MINOR). **Decision.** One remediation
wave, by root-cause family, in seven clusters whose regression proofs live in the owning stage's existing suites
and whose mutations join the owning stage's mutation script (no new R2 acceptance or mutation suite). Datastore
changes that 0001–0010 cannot take are one migration, `0011_r2_integrity.sql`: the executor-redesign guard on
`review_plans`, the review-aware `work_delegations_follow_child`, the durable `review_action_subjects`, the
distinct-evidence pattern-sharing gate with its one-open-reuse bound, and a row-preserving (D-C4-01) rebuild of
`founder_action_previews` widening its intent CHECK. Released migrations 0007–0010 join the verifier's frozen list
(R2-33, the R1-14 family); 0011 joins it in the change that releases it. **Consequence.** Every finding keeps its
frozen id; the report records root cause, fix, proof and mutation per id.

## D-R2-02 — Review integrity and one Review Pool eligibility predicate (Technical Lead, R2; R2-01, R2-02, R2-07..R2-09, R2-11)

- The owner of a Work Item may declare its version-1 Review Plan before the first run; it never supersedes it
  (`SELF_REVIEW_REDESIGN`, backed by the 0011 trigger). Founder and delegator supersession are unchanged —
  whether a delegator may *weaken* a plan is Product gap PG-01. A REWORK verdict on an exact action holds across
  plan versions: rejection is looked up by (Work Item, action fingerprint), as D-C4-05 says.
- An executor waiting on an action review is woken, in the same transaction, whenever an ACTIVE plan for actions
  exists and no live ACTION request does (plan declaration, plan-superseded decision, WAIT-settle re-check,
  startup sweep).
- Reviewer and judge selection and every decision re-check share one SQL predicate (lifecycle, VALID
  certification, data class, level, exclusions, the MANAGER / SHADOW department exemption, REVIEWER /
  QUALIFICATION / DOMAIN / **RUBRIC** holds, skill pins, the OPEN envelope). Capacity is a selection condition only
  and counts review keys plus open judgments. Exclusion history counts holding, decided or escalated reviewers and
  those whose own review work ended undecided; a transient withdrawal is not permanent. MANAGER / FOUNDER keys
  fill first. Qualification suspension withdraws open judgments too.
- Every LESSON judge draw goes through the lesson evidence gate (`assignJudge` refuses a lesson draw without it).
- The ACTION review subject is durable: written once, with the full canonical arguments, in
  `review_action_subjects`; every fill / refill / reassignment reads it; nothing is truncated — above the
  12 000-character reviewer bound the action is refused (`REVIEW_SUBJECT_TOO_LARGE`); secret-shaped arguments are
  refused (`SECRET_MATERIAL`) before any request exists. Review / judge work releases its key or judgment on every
  end path, including dead letter.

## D-R2-03 — Waits resume on the event that ends them (Technical Lead, R2; R2-02..R2-06; extends D-C1-23, R1-06, D-C2)

- A `BUDGET_EXHAUSTED` wait resumes on real headroom, not only on a cap raise: one waiter-driven, headroom-gated
  helper (`wakeBudgetWaiters`) runs on every settle below the worst case, every release (runtime, Founder
  reconciliation, tool resolution, recovery), every cap raise, the WAIT-settle re-check (headroom freed by another
  run during this run) and one startup pass. A wake whose headroom proves insufficient costs one run that re-parks
  before any spend (residual m-52).
- The C2 invariant "a child cap never exceeds its parent" reads "…for children that can still spend" (OPEN
  budgets whose Work Item can still execute, or whose run is RUNNING); lowering a cap and `accountingInvariants`
  use the same rule; a cap is still never lowered below reserved + spent, and every reservation still checks every
  level of its chain.
- One open-handoff set (OFFERED, ACCEPTED, CLARIFICATION_REQUESTED, ESCALATED) for the processor, the settle
  re-check, org acts and the trigger. A delegator never parks on its own delegate's pending question (it continues,
  bounded by `maxTurns`, to answer it); starting work accepts only an OFFERED handoff.
- Completed ≠ Reviewed at the delegation seam (D-C1-21 extended to delegations — **Product Owner confirmation
  requested**): a review-required child closes its delegation only once REVIEWED or later. Delegations already
  closed early by the 0010 trigger in an existing database are not rewritten.

## D-R2-04 — The Founder exception loop, intent resolution, attention identity, one-transaction confirm (Technical Lead, R2; R2-21..R2-26; extends D-C5-06 / D-C5-07)

- The Founder's exception decisions — an uncertain tool effect, a held reservation or governed job, an escalated
  review, a systemic finding, an escalated attribution or lesson, a pool-inconclusive outcome, a lesson promotion —
  are nine structured-only `FounderActionStore` intents (no natural-language pattern), state-guarded at preview and
  re-checked at confirm, executed at their existing boundary inside the session. Binary ones are rail actions
  posting structured previews; value-bearing ones (charging a held reservation, verifying an outcome, correcting an
  attribution's causes) stay API-only (Product gap PG-04).
- `confirm` is one `BEGIN IMMEDIATE`: check, effect, CONFIRMED, audit. Founder-authority writes join it as
  savepoints (`founderConfirmInternals.join`); FAILED means not executed.
- Founder Attention surfaces uncertain effects, held reservations, held governed jobs (once their tool decision is
  made) and escalated required reviews, per entity, at the held row's own change time. A job is governed when a run
  was attributed to an Employee **or its Work Item is an Employee's** (so a job held by a clean restore before it
  ever ran is the Founder's decision, never the C1 operator's — R1-04). Resilience exceptions are keyed per
  instance; a dismissal stands until its source changes (D-C5-06 as written).
- The grammar keeps a goal-state verb's own target, matches named acts before generic approve / reject, never
  falls back from an unmatched argument and never assumes a decision; rail and sheet buttons post structured
  previews.

## D-R2-05 — Tool-driver boundary and one run-failure vocabulary (Technical Lead, R2; R2-10, R2-12; the R1-09 family)

- A tool driver's answer is read only by `runtime/src/c2/tool-boundary.ts`: each field at most once, guarded; a
  throw or malformed answer is `DRIVER_OUTCOME_UNKNOWN` (`sent: UNKNOWN`, held, never retried blindly); the result
  is serialized once and re-parsed into frozen plain JSON; a failure code is a short code carrying no secret
  material, else `DRIVER_FAILURE`. Everything downstream (record, money, idempotency, step result, model copy) uses
  that one snapshot; `txToolResult` reads its input once, guards the serialized value and screens the code.
- `governance/src/run-failures.ts` is the only list of codes a governed run records, each with its C6 cause family
  or an explicit `null`; the runtime emits from it and C6 classifies from it. Local causes (`SETTLEMENT_FAILED`,
  `RUN_ABORTED`) and configuration causes (`NO_ROUTE_POLICY` → WORKFLOW) are never provider codes;
  `PROVIDER_CONTEXT_OVERFLOW` → CONTEXT; `PROVIDER_INVALID_REQUEST`, `PROVIDER_CONTENT_POLICY` and
  `REASONING_ABOVE_CEILING` stay unclassified until Product decides (PG-11). A runtime proof drives the real loop
  over every outcome and requires every emitted code to be in the table.

## D-R2-06 — C6 evidence identity, work time, pending causes, recovered failures and economic cost (Technical Lead, R2; R2-13..R2-20)

- The Work Item is the unit of evidence: one latest live evaluation per Work Item everywhere; a new definition
  version supersedes the older versions' live rows.
- A learning effect is judged on work *started* after training; the baseline and effect evidence name Work Items.
- Adverse evidence whose cause is not VALIDATED is never read as clean: it holds an effect at NOT_YET_TESTED
  (`ATTRIBUTION_PENDING`) and readiness at NOT_READY (`ADVERSE_EVIDENCE_PENDING_ATTRIBUTION`), a dimension it
  outweighs gets no level, the monthly review discloses it — and it is still never counted against the Employee
  (D-C6-03).
- **Amends D-C6-10 for attributions only (Product Owner CONFIRMED 2026-09-30, PO-R2-A in D-R2-15):** a pool judge's FAIL on an
  attribution escalates to the Founder (who decides with corrected causes through `decideAttribution`) instead of a
  terminal REJECTED no one can correct. Lessons are unchanged (FAIL rejects).
- Only an unrecovered system failure can be the primary cause; a recovered one is at most CONTRIBUTING / LOW. The
  standard calibration carries a recovered-tool-failure KNOWN_BAD case.
- A pattern is shared only after two verified reuses on pairwise-disjoint evidence, one open reuse per (lesson,
  Employee); author self-reuse counts only on distinct evidence (PG-03); System Contribution credits only another
  Employee's reuse.
- A systemic problem recurring after REJECTED / ADDRESSED opens a new linked finding (`key#n`) counting only
  evidence validated after the decision; retraining exhaustion merges into an open candidate.
- C6 cost buckets are economic micros (D13-G.3 / G.8), with the bill carried separately; zero recorded cost earns
  no EFFICIENCY verdict.

## D-R2-07 — Memory policy on promotion, Academy retest gates, live recertification set (Technical Lead, R2; R2-27, R2-34, R2-35)

- A PERSONAL lesson promotion opens claim conflicts with the Employee's live disagreeing memories through the
  Memory Write Policy's own mechanism (`txOpenMemoryConflicts`), in the same transaction; both records are kept
  and important work is held (Stage 5 §5 / §7). Automatic supersession stays a Product decision.
- After a retrained failure only the retest and later attempts of that kind decide the Academy gates (the
  SIMULATION gate mirrors the ASSESSMENT "retrained" guard); a remediation is re-tested only by an attempt of the
  failed kind; stage history records real transitions only.
- `skill_updates.impact_json` is the plan-time record, not an authority set: a rollout recomputes the pinned
  passports and certifications inside its transaction; a rollback returns every passport the rollout moved.

## D-R2-08 — Resilience honesty and a structural maintenance lifecycle (Technical Lead, R2; R2-28..R2-31; extends D-C6-06)

- Only an operator-attested destination meets the off-device objective; a different volume is SEPARATE_VOLUME and
  raises OFF_DEVICE_NOT_PROVEN (a volume id cannot tell a second partition from a removable drive).
- A clean restore is an ambiguity boundary: every QUEUED / WAITING / CLAIMED job that could reach an external
  effect (a prior UNSAFE run, or the owner holds an ACTIVE grant on an UNSAFE / external-mutating action) is held
  `RESTORED_PAST_BACKUP_POINT` and decided per job by the Founder; the report discloses held job ids, the
  authenticated backup point and the data age. Bulk reconciliation stays PG-10.
- `CompanyStore.open` migrates only a fresh database; an existing Company with pending migrations is refused
  (`SCHEMA_UPDATE_REQUIRED`) and upgraded only through safe-upgrade, which `CompanyRuntime.start` runs
  automatically (Stage 12 §38); it refuses to start on ROLLED_BACK_UPDATE_HOLD. Maintenance refuses
  `DATABASE_IN_USE`, writes the hold before any restore touches files, and reports MAINTENANCE_FAILED with the hold
  kept. File removal uses `unlinkSync` (Node 24 `rmSync` fast-fails on Windows for a locked non-ASCII path).
- A rollback measures post-activation work against the activation baseline and is refused
  (`POST_UPDATE_WORK_EXISTS`) unless acknowledged; it writes hold and journal first, keeps a never-pruned
  pre-rollback snapshot and reports what it discarded. The "proven stable" bound stays PG-09. Local recovery status
  and retention count restorable generations only (record and files).

## D-R2-09 — A budget wait resumes on the need its refusal recorded (Technical Lead, R2 second wave; RR2-1; supersedes the headroom test of D-R2-03)

A BUDGET_EXHAUSTED refusal records, in the refusing transaction, its need in the append-only `budget_wait_needs`
(0011): the refused level, scope and dimension, the wait level (the refusing level; for a Run-level refusal its Work
Item level) and the refused money / tokens. Every resume path — settle below the worst case, release, Founder
reconciliation, cap raise, WAIT-settle re-check, startup pass — applies one predicate to the job's latest need: the
need fits a fresh Run budget and `checkReservation(need)` passes on the wait level and every ancestor; a waiter is
considered only when a level it depends on changed. Headroom smaller than the need wakes nothing (no wake storm);
no resume decision scans historical reservations. Waits parked before the table existed keep the D-R2-03 headroom
test. Consequence: a refusal caused only by the per-run cap whose need fits a fresh run resumes at once in a new
run, still bounded by the Work Item cap.

## D-R2-10 — A handoff never outlives its delegator (Technical Lead, R2 second wave; RR2-2, RR2-5; extends D-R2-03)

A FINAL refused for a pending delegate question is recorded as that step's result
(`FINAL_REFUSED_CLARIFICATION_PENDING`, naming the delegations), so the model sees what to answer (the loop stays
bounded by `maxTurns`). When a delegating Work Item ends FAILED / CANCELLED / SUPERSEDED, the 0011 trigger
`work_delegations_follow_parent` closes every open handoff it holds in the same transaction (CANCELLED,
`PARENT_ENDED`, history row); a FAILED delegator cancels its delegated children through the canonical termination
path (children held for reconciliation and completed children are kept; their delegation closes); no executable
work is enqueued under an ended propagating parent (a kept child sent back to rework is cancelled, not re-queued).

## D-R2-11 — Freed reviewer capacity is a wake; blocking reviews before learning judgments (Technical Lead, R2 second wave; RR1-2; extends D-R2-02)

A review slot (a review key or a pool judgment, both counted in capacity) that leaves ASSIGNED — decided, escalated,
withdrawn or released — refills, in the same transaction, every domain its holder actively reviews in. Every refill
serves waiting REQUIRED requests first, then Independent Oversight, then pending pool judgments of that domain
(oldest first, insertion order as tie-break), each through the one eligibility predicate decided before any LIMIT;
a judge draw yields to waiting REQUIRED reviews; a withdrawal's refill never re-draws the withdrawn subject; the
startup sweep refills every waiting request (ACTION included) before judgments. No polling: the capacity change is
the wake; new review jobs advance the durable wake generation through the queue triggers.

## D-R2-12 — One meaning of adverse evidence in every attribution state (Technical Lead, R2 second wave; RR3-A/B/E; refines D-R2-06 — **REJECT semantics Product Owner CONFIRMED 2026-09-30, PO-R2-B in D-R2-15**)

`adverseStanding` is the single definition every C6 reader uses (profile, readiness, capability regression,
learning-effect assessment, reports): VALIDATED and the Employee's own judgment → ACCOUNTABLE (the only standing
counted against the Employee, D-C6-03); VALIDATED with another cause → excluded; PROPOSED, or none while one is due
→ PENDING (not counted, never read as clean: disclosed, holds readiness, keeps an effect open); REJECTED → decided
"no accountable cause established" (never pending, never counted; disclosed as `unattributedAdverse` and the monthly
`ADVERSE_EVIDENCE_WITHOUT_ACCOUNTABLE_CAUSE`; an adverse follow-up in this state makes a learning effect
INCONCLUSIVE — recorded, re-assessable, not final, and it does not block the next cycle); none and none due →
not a cause question (disclosed count only). "Due" is the evaluator's own proposal predicate, recorded with each
evaluation. `ATTRIBUTION_DECIDE` accepts optional corrected `causes` for VALIDATE only (API-only, PG-04); a REJECT
carrying causes is refused. Learning-effect evidence is asymmetric: positive evidence is work started after
training; adverse evidence is any comparable, non-baseline work with a run after training.

## D-R2-13 — The command's own verb decides (Technical Lead, R2 second wave; RR1-1; refines D-C5-07 / D-R2-04)

A Founder natural-language command is mutating only when its leading verb (after polite words and an addressee) is
a mutating verb. The verb fixes the intent family and the approve / reject decision; the head noun after the verb,
or the closing goal noun / budget clause, picks the act within the family; a goal-state verb yields only
GOAL_STATE with its state from the verb; words inside the argument never select or change the intent or decision;
a command with no leading verb is never an act. The grammar stays closed and deterministic. Fail-closed side
effect: a mutating verb not in the leading position ("Ehab approve X" without a comma) is UNKNOWN.

## D-R2-14 — A restore-check target is a verification copy, never a Company (Technical Lead, R2 second wave; RR4-1; refines D-R2-08)

`restoreToIsolatedWorkspace` (CLI `restore-check`, restore drills) writes a permanent `RESTORE_CHECK_COPY` update
hold before the database exists; every ordinary open, safe-upgrade and rollback refuses it; `clear-update-hold`
refuses to clear it; only the check's own internal open and read-only verify-mode inspection open it. A restored
Company becomes live only through the controlled restore (`restorePortableBackup`: effect-capable jobs held, opened
at its own version, safe-upgrade). No second live-restore path exists.

## D-R2-15 — Product Owner confirmations for the R2 architecture closure (Product Owner, 2026-09-30)

Recorded from the R2 Architecture Closure Correction brief (`R2-ARCH-CLOSE`), which the Product Owner approved.

- **PO-R2-A — D-R2-06 attribution dispute semantics: CONFIRMED.** A Review Pool judge who FAILS / disputes a proposed
  causal attribution neither silently authors a corrected cause nor terminally rejects it: the attribution escalates
  to the Founder, who may VALIDATE it as-is, VALIDATE corrected causes, or REJECT it. Lessons keep their independent
  review semantics (FAIL rejects). This confirms the D-R2-06 amendment of D-C6-10 for attributions.
- **PO-R2-B — D-R2-12 Founder REJECT semantics: CONFIRMED.** A Founder REJECT means *no accountable cause has been
  established from the available evidence* — not "the Employee did nothing wrong" and not "the event did not occur".
  The adverse evidence stays disclosed, is not counted against the Employee, is not pending forever, makes a learning
  effect INCONCLUSIVE / reassessable (never a final NO_IMPROVEMENT), and a later independent, properly evidenced event
  may still establish a new cause.
- **PO-R2-C — Work spanning the training boundary: CONFIRMED.** Learning-effect time is event-based, not
  Work-Item-based. Positive evidence: the follow-up Work Item itself started after training completed and reaches the
  qualified-outcome standard. Adverse / recurrence evidence: the specific adverse source event supporting the
  recurrence occurred after training completed and the ordinary attribution rules establish the target accountable
  cause. Work started before training: its pre-training mistakes never become post-training recurrences because
  review / evaluation / attribution / completion happened later; a real post-training occurrence may count; correct
  completion after training with no new adverse event is neither positive nor negative evidence. When event time or
  provenance cannot place the adverse behaviour on one side of the boundary, the result fails closed to INCONCLUSIVE /
  NOT_YET_TESTED — never a final NO_IMPROVEMENT or REGRESSION.
- **PO-R2-D — AC-01, Title ≠ Authority for Department Goals: CONFIRMED.** For an Employee to derive or link a
  Department Goal from a governed run BOTH are required: the applicable Director seat / organizational eligibility
  and an explicit Founder-delegated capability grant, through the existing permission / grant / governed-run system.
  Neither replaces the other; no authority is implied by a title. PG-08 (Department-scoped grant semantics) is not
  implemented: department scope stays constrained by the Director's actual seat / placement. This resolves AC-01 in
  favour of the Founding Constitution / Stage 3 / C4 rule.

## D-R2-16 — Budget capacity is admitted, not broadcast (Technical Lead, R2 architecture correction; FA-1; supersedes the resume rule of D-R2-03 / D-R2-09, keeps D-R2-09's need semantics)

Freed budget capacity has one durable owner before a `BUDGET_EXHAUSTED` waiter resumes. One admission pass
(`admitBudgetWaiters`, `governance-core.ts`) runs inside every capacity-changing write transaction — a settle below
the worst case, a release, a cap raise or trim, a released or partly consumed admission, the WAIT-settle re-check and
the startup pass — and replaces `wakeBudgetWaiters`. It takes waiters by job priority, then FIFO by created time, then
id; admits a waiter only when its latest recorded need fits a fresh Run budget and the remaining capacity of every
level of its Work Item chain; records the admission in `budget_admissions` (0011: ADMITTED → CONSUMED | RELEASED, at
most one outstanding per job, never deleted, SQL-guarded) and subtracts it before the next waiter. A waiter that does
not fit never blocks a later one that does. Admissions are not reservations: reserved / spent and
`accountingInvariants` are unchanged, but every reservation check (`budgetCapacityCheck`) counts OTHER jobs'
outstanding admissions, and the admitted job's reservation consumes its own. A job leaving QUEUED / CLAIMED, a
replaced need or a lowered cap (trimmed newest first; the "never below reserved + spent" floor is unchanged) releases
the admission and re-admits in the same transaction; 0011 triggers back the release up. Startup reclaims stale
admissions; a recovered claim keeps its admission. Waits parked before needs existed hold all positive headroom,
capped by a fresh Run budget. Admission never raises a cap, grants budget, spends, routes or approves.

## D-R2-17 — Learning-effect time is the source evidence event's time (Technical Lead, R2 architecture correction; FB-1; implements PO-R2-C; refines D-R2-06 / D-R2-12)

Replaces "adverse evidence is any comparable, non-baseline work with a run after training". Adverse learning evidence
is the SOURCE EVENT — a counting REQUIRED review FAIL, an unrecovered or boundary run failure, a decisive NOT_ACHIEVED
outcome verification — timed by the Employee's act (the reviewed or verified output's run, the failed run, an action
review's request), never by review, evaluation, attribution or correction time (`adverseSourceEvents`,
`improvement-core.ts`; `eventPhase`, `assessLearningEffect`, `mind/src/improvement.ts`; ids, kinds and times only). An
attribution explains exactly the events its immutable evidence refs hold (the first decided one stands; corrected
causes keep the proposal's refs and so the original time); an undecided proposal is re-proposed when new adverse
events arrive. A recurrence is a post-training event (act started after `trainingCompletedAt`) explained by a
VALIDATED accountable attribution of the target cause. Positive evidence stays work started after training. Work
started before training counts only through its post-training events; finishing it correctly is neither positive nor
negative. Events are deduped by source identity; the share unit stays the Work Item; the baseline is unchanged.
Unplaceable events, unresolved attributions or adverse work without provenance never yield a final NO_IMPROVEMENT /
REGRESSION they could change (INCONCLUSIVE). `adverseStanding` is unchanged. No schema change.

## D-R2-18 — A live restore is blocked until it is fully safe to become a Company (Technical Lead, R2 architecture correction; FB-2; refines D-R2-08 / D-R2-14)

`restorePortableBackup` authenticates and verifies the package off-target, then creates exclusively and fsyncs a
`RESTORE_IN_PROGRESS` hold (the update-hold file: attempt, package, backup, source schema, phase; directory fsync, only
Windows EPERM / EISDIR tolerated) BEFORE any database or artifact byte, and writes every byte exclusive-create +
fsync. Every store open refuses it before touching the workspace — read-only verify-mode inspection included — as do
safe-upgrade, rollback, runtime start, Command Center startup and `clear-update-hold`; only the lifecycle's own open,
bound to the marker's attempt id AND package id, passes (`assertRestoreGate`). The controlled-restore transaction
(integrity / FK checked, sessions and launch tokens revoked, effect-capable jobs held, drill + audit) records the
attempt id; the hold is lifted only after commit and store close (phase COMMITTED, atomic rename to history). Re-running
with the same package finalizes a committed attempt or redoes any other from the package; another package needs an
explicit `--discard-partial-restore`. A thrown failure is handled as a crash (the target stays held). `restore-status`
inspects it without opening the database. `RESTORE_CHECK_COPY` is unchanged and separate.

## D-R2-19 — A Department Goal act needs the Director seat AND an explicit Founder-delegated grant (Technical Lead, R2 architecture correction; AC-01; implements PO-R2-D; supersedes the "seat-checked" clause of D-C5-04)

`goal.derive` / `goal.link` from a governed run (`txGoalAct`) need BOTH the run's Department Director seat (current;
ACTING only within its window and scope) AND an ACTIVE grant of `org.goal.derive` / `org.goal.link` (registered `org.*`
capabilities, Founder-delegated through `delegateAuthority`), decided by `decideOrgAct` (expiry, revocation, risk /
data ceilings, use limit). Neither implies the other; derive never implies link. A `NO_GRANT` denial goes through
`recordDenial` (containment) and consumes nothing; a DONE act consumes one use (audit `goal.act`); replay of the
Employee's own recorded effect stays idempotent without exercising anything new. The Founder `GoalStore` path is
unchanged. PG-08 Department-scoped grants are not implemented; no migration.

## D-R2-20 — Freed admission levels; sequential attribution generations; one undecided proposal; Founder escalation is immutable (Technical Lead, R2 final simple closure fix; RA-1, RB-1, RB-2; refines D-R2-16 / D-R2-17)

- **RA-1.** A cap trim re-admits on the UNION of every released admission's own levels (the lowered level and its
  ancestors), in the same transaction — like every other release path — never on the lowered level alone.
- **RB-1 / RB-2.** `causal_attributions` holds sequential generations per Work Item (0011 replaces the 0010
  "one PROPOSED-or-VALIDATED" index with "at most one PROPOSED"): any number of decided (VALIDATED / REJECTED)
  generations are history and never reopen. An undecided proposal is never superseded because new adverse evidence
  arrived (only a changed cause re-proposes it, and never one a pool judge ESCALATED — that one is the Founder's until
  decided, PO-R2-A); new events wait for it. With no undecided proposal, the adverse source events no decided
  generation's evidence refs cover get ONE new generation holding only them (also on an unchanged-evidence
  re-evaluation after a decision), through the ordinary Review Pool / Founder path (PO-R2-C). Each event is explained
  by the generation whose refs hold it. Work-Item-level readers collapse generations to one unit: the undecided one
  first, else the VALIDATED ones (accountable when any is; the union of their causes), else the latest REJECTED; single
  VALIDATED lookups read the latest; a systemic candidate counts distinct Work Items.
- **Learning provenance.** A learning signal keeps the generation it was classified on: the lesson validation gate,
  intervention planning and a reported systemic problem read the signal's own `attribution_id` (when a decision
  SUPERSEDED it — Founder corrected causes or a re-proposal — its earliest VALIDATED successor whose evidence holds all
  of its references); only a signal recorded without an attribution falls back to its Work Item's latest VALIDATED one.

## D-C7A-01 — C7 split into four bounded sub-stages; APP-OPS-01 frozen; future Marketing Operations and the Founder publish gate (Product Owner / Founder, recorded at the C7-A start, 2026-10-01; recorded, not reopened)

- **APP-OPS-01 is CLOSED / FROZEN** in the App's Product track. The Company summaries that still called it a
  candidate were lifecycle drift; they are synced (`COMPANY_CANONICAL_BASELINE.md` §6, `BOUNDARIES.md`). Approved App →
  Company operational domains: service / app health; crashes / errors; latency / performance; session status; call
  status; AI provider; model; runtime path / state; cost / usage cost; feature usage; subscriptions / business metrics;
  releases / version adoption; ratings / reviews; user-specific operational diagnostics without user content. Approval
  of a domain is not evidence that the App emits it; no source or data is invented. Ratings / reviews enter the
  content-free core only as aggregate metrics; public review text is outside C7-A. Rules A / B / C are unchanged and
  have no incident exception.
- **C7 is one roadmap stage implemented as four bounded sub-stages:** C7-A Operational Data + External Outcome Core;
  C7-B Governed App Operations Control Plane; C7-C Pilot Instrumentation Pack; C7-D Marketing, Website & Social
  Operations. Each is a separate work package with its own review; none implements another's scope.
- **Future C7-D (recorded only, not implemented by C7-A).** Marketing Operations becomes a major operating unit,
  strategically directed by Brand & Creative + Strategic Market Intelligence, with strong Growth collaboration and one
  clear day-to-day operating lead (website, SEO / content / landing pages, social accounts, content and creative
  production, video editing / motion, scheduling and publishing, community management, marketing analytics and
  campaign learning). **At initial Company operation every external publication in QANDEEL's name requires explicit
  Founder approval before Publish**; Employees may research, ideate, create, edit, review and prepare autonomously.
  Delegated publishing may exist later only by a deliberate, bounded, revocable Founder grant based on demonstrated
  trust — never automatically. C7-A adds no publishing, website editing, social connector, marketing staffing or sixth
  top-level Department; C4's canonical five-Department set is unchanged.

## D-C7A-02 — One governed intake core, two semantic lanes, extending C6 (Technical Lead / executor, C7-A; architecture gate)

- **Lanes.** An `OPERATIONAL_EVENT` is a content-free fact of one of the frozen App → Company operational domains; an
  `EXTERNAL_OUTCOME` observation is a measured real-world result (search, web, store, business, campaign, social, App
  health). Both enter through ONE intake core (`ExternalEvidenceStore.ingest`) and ONE record table
  (`external_records`, lane-specific CHECKs); an operational fact is never outcome evidence.
- **Where the code lives.** The pure intake kernel (contracts, allowlist, privacy refusal, lifecycle, role matrix) is
  `packages/governance/src/external-evidence.ts` — policy, like the D0..D4 data classes; storage owns
  `external-core.ts` (the one usable-evidence predicate, read by every C6 seam) and `external-evidence.ts` (the store).
  No new package: a C7-A package would have been a thin wrapper over governance + storage, not a subsystem.
- **No parallel engine.** `External evidence → Outcome Verification → C6 Evaluation → Attribution → Learning /
  Performance / Reporting`: C7-A writes no evaluation, attribution, lesson, report or Work Item state (verifier rule
  `c7a-extends-c6-only`). No transport, listener, queue, SDK or provider dependency is added.

## D-C7A-03 — External-outcome availability is runtime truth; the C6 refusal becomes the governed rule (Technical Lead / executor, C7-A)

- `EXTERNAL_OUTCOMES_AVAILABLE` is removed. The Eval Registry receives `{ governedSource }` from durable source state
  (`assertEvalDefinition(spec, external)`, default fail-closed); reports receive `ExternalOutcomeFacts`.
- An outcome verification may cite `EXTERNAL_OUTCOME` exactly when it cites `external_record:<id>` references and every
  one is USABLE for the verified Work Item: an outcome-lane record, of an ACTIVE source, without a conflicting replay,
  under an ACTIVE Founder `OUTCOME_EVIDENCE` binding to that Work Item (`txAssertExternalEvidence`, both verifier paths).
  No governed source → `EXTERNAL_OUTCOME_UNAVAILABLE`, as before.
- Migration 0012 replaces 0010's `evidence_classes_json NOT LIKE '%EXTERNAL_OUTCOME%'` CHECKs on
  `outcome_verifications` and `review_outcome_judgments` by the row-preserving rebuild of D-C4-01 (rows copied back
  BEFORE the 0010 triggers are re-created) and adds triggers that re-check the same predicate in the datastore.
- The pinned C6 mutation `c6-external-outcome-invented` keeps its id and now targets the runtime gate
  ("no governed source is active").

## D-C7A-04 — Governed source registry: Founder-decided, contract-pinned, forward-only (Technical Lead / executor, C7-A)

- A source is a stable, provider-neutral key and family (`APP_OPERATIONS`, or one outcome family); a provider is a
  source registration, never an evidence contract. Lifecycle DRAFT → ACTIVE ⇄ SUSPENDED → RETIRED (final), enforced in
  code and by trigger; history append-only; nothing is deleted.
- Contracts are code-defined, closed, versioned (`ops.events@1`, `outcome.metrics@1`) and pinned per source by the
  SHA-256 of their canonical definition: a definition that changes without a version bump fails closed
  (`CONTRACT_DRIFT`); a new version is a Founder registration that supersedes the current one for new intake only.
- Registering, deciding and binding are Founder acts through the existing chokepoint (`founderAdminWrite` + `founder`)
  and four structured-only governed-confirmation intents (`SOURCE_REGISTER`, `SOURCE_DECIDE`, `EVIDENCE_BIND`,
  `EVIDENCE_UNBIND`; `founder_action_previews` rebuilt like R2-21). No Employee, model or producer can authorize a
  source; no parallel approval subsystem. Founder Attention receives only a source awaiting activation and a source
  integrity conflict.
- No credential is stored: a provider credential never enters SQLite (verifier column rule).

## D-C7A-05 — Intake: allowlist first, refusal without echo, idempotent by producer identity (Technical Lead / executor, C7-A)

- The envelope is screened before anything reads it (even its source key): arrays, depth, size, forbidden key NAMES at
  any depth (private content, credentials, raw payloads, free-form bags), whitespace in any value (free text cannot
  ride in an identifier) and secret-shaped values are refused with a reason CODE. Every field of every type is declared
  with a bounded shape; numeric units are fixed by the contract, never chosen by the producer.
- A refusal is audited in its own transaction with the reason code and at most a DECLARED field name — an unknown key
  may itself be content and is never repeated. Nothing refused is stored.
- Identity is (source, producer event id); the fingerprint is the SHA-256 of the canonical normalized identity. An exact
  replay is a no-op returning the canonical record; a different fingerprint is a conflicting replay — recorded,
  audited, evented, never applied — and the first record stops being usable evidence. Event time and receipt time are
  distinct; out-of-order delivery is accepted; a future occurrence beyond a 5-minute skew is refused.

## D-C7A-06 — User-scoped diagnostics carry a pseudonym that is never stored (Technical Lead / executor, C7-A; within Rules A / B / C)

`user.diagnostic` accepts only a producer-side 64-hex pseudonym, a code and a state. The pseudonym contributes to the
occurrence fingerprint (two users' identical facts are distinct occurrences) and is never part of the stored
normalized fields (datastore trigger) — there is no per-user record, lookup, search or browsing path; per-user facts
are visible only as an aggregate count. Future automated per-user reliability processing would need its own governed
design. Ratings / reviews enter only as aggregate metrics; public review text is outside C7-A (D-C7A-01).

## D-C7A-07 — Explicit Founder bindings; evidence is never a verdict (Technical Lead / executor, C7-A)

- Only the Founder binds an accepted record to an existing Work Item or Goal: `OUTCOME_EVIDENCE` (outcome lane; Work
  Item or Goal) or `DEPENDENCY_FAILURE` (an operational fact that signals a failure; Work Item only). No timing
  inference, no "best match", no Employee self-binding (`bound_by_ref` must be a Founder ref, CHECK). Revoking or
  superseding keeps history; a binding of a suspended source or a conflicted record is refused.
- A record or a binding changes no Work Item, evaluation, attribution, lesson, authority, budget or App behaviour. It
  becomes useful only through C6: a verifier (the Founder, or the Review Pool where the plan delegates judgment) cites
  it; the Review Pool's cited external evidence is re-checked at resolution and, if no longer usable, the outcome is
  recorded INCONCLUSIVE for the Founder (never silently decided on what remains).
- The evaluator sees `EXTERNAL_OUTCOME` (and cites the records) only from a verification that cited usable evidence;
  `WorkEvidence.failures.external` counts Founder-bound dependency failures of ACTIVE sources — so the existing,
  unchanged attribution rules can choose `EXTERNAL_DEPENDENCY`; a negative external result alone yields at most a
  PROPOSED cause that nothing counts until an independent decision.
- Reports state the three truths: `EXTERNAL_OUTCOMES_UNAVAILABLE` (no governed source), `EXTERNAL_OUTCOMES_NO_RELEVANT_EVIDENCE`
  (citing the sources), or `EXTERNAL_OUTCOME_EVIDENCE` / `EXTERNAL_OUTCOMES_IN_VERIFICATION` (citing record, binding and
  verification refs). No automatic success threshold exists (C7-C).

## D-C7A-08 — One outbox: the `external_source` aggregate (Technical Lead / executor, C7-A)

The provider-neutral outbox gains the `external_source` aggregate (0012 rebuilds `events` to widen its CHECK; every row
and its `seq` kept; AUTOINCREMENT continues) and six content-free event types: registered, contract registered, state
changed, record accepted, conflict detected, binding changed. State, history, audit and the event commit in one
`BEGIN IMMEDIATE`; an exact replay writes nothing.

## D-C7A-09 — Proofs, verifier, mutation and CI for C7-A (Technical Lead / executor, C7-A)

- Proofs: `governance/test/c7a-intake.test.ts`, `storage/test/c7a-external-evidence.test.ts` (brief §18 items 1–35),
  `mind/test/c7a-kernel.test.ts`, `runtime/test/c7a/c7a-runtime.test.ts`; `scripts/c7a-mutation-check.mjs` (29
  mutations, pinned, sharded 2 + 1 in CI, counted by the quality gate; 46 (48 with the pattern-reuse correction) and sharded 4 + 2 after D-C7A-10 / D-C7A-11,
  whose datastore mutations re-pin the mutated migration in the compiled pin table for their run only).
- Verifier: `c6-external-outcomes-unavailable` is replaced by `external-outcomes-governed` (no static flag; the governed
  verification call; the four usable-evidence conditions; the datastore triggers); new `c7a-not-claimed-closed`,
  `c7a-proofs-present`, `c7a-intake-content-free`, `external-evidence-writes-confined`, `c7a-extends-c6-only`,
  `c7-later-scope-not-leaked`; 0011 joins the frozen migrations. `no-app-ops-implementation` is unchanged: C7-A code
  uses the neutral "operational" vocabulary, so any App-side / transport implementation named for APP-OPS still fails.
- No separate C7-A acceptance script: the storage proof suite exercises every path end to end through the real stores
  (Founder chokepoint, governed confirmation, Review Pool, C6 evaluator) and the runtime suite proves the signalling
  contract and the read-only CLI; the live-runtime pilot of real sources belongs to L1 / C7-C.

## D-C7A-10 — The datastore holds the registered contract, not only TypeScript (Technical Lead review MAJOR 2, C7-A)

- Finding (TL exact-head review of `194599c`): migration 0012 re-checked an ACTIVE source, its CURRENT contract, the lane
  and a global field allowlist, but not that a record's type, domain, unit, scope and type-specific fields belong to the
  contract its source registered. A direct datastore write could create trusted evidence the TypeScript normalizer
  refuses.
- Decision: the release's contract catalogue lives in the datastore — `external_contract_catalog` (code, version, lane,
  digest), `external_contract_families`, `external_contract_types` (domain, source family, unit, value bounds and
  integrality, window rule, user scoping, failure-signal rule), `external_contract_scopes` and `external_contract_fields`
  (each stored field with its shape: enum values, int bounds, code / ident / version / currency / ratio). It is seeded in
  0012 from the same `EXTERNAL_CONTRACTS` the kernel validates with, then frozen by triggers (a later contract version
  arrives in its own migration). A storage proof holds catalogue = TypeScript definitions exactly, so there is one
  definition with two enforcement points.
- Triggers: `external_source_contracts_catalogued` (a source registers only a catalogued version for its family and lane,
  pinned by the catalogued digest); `external_records_conform_to_contract` (type of the source's contract AND family, its
  own domain, unit, bounds, window, allowed scope, user scoping and derived failure signal); `external_records_fields_conform`
  (stored fields are exactly the type's declared fields, each in its shape; required ones present). The TypeScript drift
  check stays as the first, typed refusal.
- 0012 is amended in place, not followed by a 0013: it is part of this unmerged candidate (no released Company has
  applied it); 0001–0011 are untouched and the new pin replaces the candidate's.

## D-C7A-11 — A late integrity conflict takes a disputed outcome out of current C6 truth (Technical Lead review MAJOR 1, C7-A)

- Finding: a conflicting replay made a record unusable for NEW use, but a decisive verification that had already cited it
  stayed current truth — the Work Item kept its qualified evaluation and profile / economics / learning gates / reports
  kept counting an outcome resting on contested evidence.
- Decision: a verification is history and is never rewritten; its CURRENT validity is a separate append-only record,
  `outcome_verification_validity` (none = valid). The datastore trigger `external_record_conflicts_contest_verifications`
  contests, in the conflict's own transaction and whoever writes it, every current verification citing the conflicted
  record. Only an evidence-integrity conflict contests: suspending, retiring or unbinding never invalidates history.
- C6 consumes it through its own lineage: `latestVerdict` carries the validity; `gatherWorkEvidence` reads a contested
  verification as no current outcome plus `outcomeContested`, which the kernel's `evidenceConflicts` states as
  `OUTCOME_EVIDENCE_CONTESTED` (CONFLICTING_EVIDENCE, never qualified, never an adverse event of the Employee); the intake
  path then restates the Work Item's live evaluations through the same evaluator (`txRestateCurrentTruth`: a new result
  supersedes the qualified one, which stays history). Reports state the contestation (`EXTERNAL_OUTCOME_CONTESTED`,
  `OUTCOMES_CONTESTED`) and never count it as a result; Founder Attention gets one NEEDS_DECISION item per contested
  verification; reviewer calibration ignores a verdict that is not current; a successful-pattern lesson (it stays
  VALIDATED as history) counts as a contribution, a report claim or a shareable pattern only while its success is current
  qualified truth; the runtime announces an intake conflict that committed (`recorded`), though `ingest` refuses it.
- Resolution is a Founder decision through the governed confirmation (`OUTCOME_CONTEST_RESOLVE`, structured only):
  UPHOLD (it stands, current again), REPLACE (a Founder re-verification of the same Work Item and verdict on usable
  evidence — the governed external-evidence rule applies, so never on the disputed record; `replaces_verification_id`,
  one per verification) or RETRACT (no current verified outcome). REPLACED / RETRACTED are final; a NEW conflict after
  UPHOLD contests again. Each decision restates C6 truth in the same transaction.
- Kept as is (residual): the Work Item lifecycle state (OUTCOME_VERIFIED / CLOSED) is history and is not reversed, and a
  replacement keeps the verdict — a verdict change after a contest would need a Work Item lifecycle Product decision. A
  causal attribution already VALIDATED on a contested NOT_ACHIEVED outcome is not reopened (C6: decided generations never
  reopen); the contested verification is no longer an adverse source event for learning effect.
- Pattern reuse (Technical Lead exact-head review of `e895bcf`, same root cause): the `PATTERN_OUTCOME_CURRENT` gate
  also governs reuse. `txPlanIntervention` refuses a `PATTERN_REUSE` of a pattern whose originating success is not
  current qualified truth (`LEARNING_GATE` / `PATTERN_OUTCOME_NOT_CURRENT`; TARGETED_RETRAINING is not a pattern
  authority and is untouched). `txRestateCurrentTruth` cancels, in the same transaction, every open (PLANNED /
  TRAINING_COMPLETED) reuse of a pattern that Work Item's success produced once it is no longer current — the existing
  forward-only CANCELLED state (history row `intervention.pattern_outcome_not_current`, audit
  `learning.intervention_cancelled`), so it never completes, never yields IMPROVEMENT_OBSERVED and never counts toward
  sharing; the 0010 forward trigger makes CANCELLED final. A verified reuse counts as the author's contribution only
  while its pattern's success is current. UPHOLD / a valid REPLACE re-open only FUTURE reuse; an interrupted reuse stays
  history (no automatic resumption); RETRACT keeps reuse unavailable. No schema change.

## D-C7B-01 — C7-B Product decisions (Founder / Product Owner, recorded at the C7-B start, 2026-10-01; recorded, not reopened)

Recorded from the approved C7-B brief and the frozen App-side APP-OPS-01 contract (read-only, PO-OPS-07 / -08 / -09 /
-15 / -16 / -17 / -18 / -19): the Company owns its decisions and the **issuing** of governed controls, the App owns
Product truth and every **effective** control value; a Company outage or a missing / unauthenticated response is never a
control; exactly seven families (Feature Flags, Kill Switch, Maintenance Mode, Rollout Control, Minimum Supported
Version, Approved Remote Configuration, Model / Provider Route Hold) and no eighth without controlled Product /
Architecture approval; no generic remote execution (new App code is a release); a control only restricts — a less
restrictive revision or a RELEASE removes the Company's own overlay and grants no Product, entitlement, launch,
consent, privacy or Safety authority; no initial Remote Configuration family is approved; a Route Hold is negative only;
the persistent **QANDEEL App Operations & Release Lead** (Product, under the Product Director) is distinct from the App
Store Release & Reputation Lead, and Title ≠ Authority; every Company → App control issue / change / release is **R3** in
Strong v1 (independent review AND Founder approval), with no emergency bypass. Transport, authentication, signing, TTL,
last-known-good, App-side retention and application are later App-side Production Integration / Security work.

## D-C7B-02 — One control plane inside the existing governance (Technical Lead / executor, C7-B; architecture gate)

- A control revision is the Employee act `control.propose` (`ORG_ACTIONS`), reached from a governed run as an
  `ORG_ACTION` proposal through the existing fenced `txOrgAct` boundary (idempotent per Work Item step, containment on
  denial). `orgActRequest` decides it at **R3 on the family's grant resource** (all other organizational acts stay R1 on
  `*`); `decideEmployeeAction` therefore returns review `INDEPENDENT` AND approval `FOUNDER`.
- The act needs the explicit capability `app-control.issue` (one bounded capability; resource = a family code or `*`)
  with an R3 ceiling — a Founder-created C2 grant; it is not an organizational capability, so Founder delegation (R1)
  can never confer it and nobody self-grants — AND the App Operations & Release Lead seat (primary, or acting coverage
  whose scope names the act). A seat without a grant, or a grant without the seat, issues nothing.
- Independent review is the existing ACTION review (`actionReviewGate`, the Work Item's Review Plan, the Review Pool;
  the maker is excluded; no plan → refused). When it is SATISFIED, `applyOutcome` puts exactly that act to the Founder as
  a PENDING R3 approval (`upsertApprovalRequest`, `argsSha256` = the act's fingerprint); REWORK ends the proposal.
- The Founder decides through the existing approval engine (`decideApproval`, reached in production through the
  existing governed confirmation `APPROVAL_DECIDE`, whose preview now states the control decision-ready: family,
  scope, operation, value, from → to, reason, evidence, review). Approval **issues** in the same transaction
  (`txControlApprovalDecided`): the next revision, the review and the approval consumed once, concurrent proposals of
  the series STALE (their pending approvals REVOKED). REJECT ends the act; the same act never regenerates.
- No new approval, review, confirmation, attention, audit, event or organization system; no new Founder intent (an R3
  approval already reaches Founder Attention). Review conflicts / escalations of a control reach the Founder through the
  existing items.

## D-C7B-03 — Desired ≠ effective; the outbound read seam (Technical Lead / executor, C7-B)

The only Company state of an issued revision is `ISSUED` (datastore CHECK). There is no applied / delivered /
acknowledged / effective state, column or table, and none may be fabricated before authenticated App-side evidence
exists. `AppControlStore.issuedControls()` is the deterministic, bounded export (`company.issued-controls@1`: series,
revision, family, scope, operation, typed value, issued time, digest, `companyState: ISSUED`) — no rationale, actor,
evidence, secret or metadata bag; a digest is a fingerprint, never authentication. No transport, listener, webhook,
queue or SDK exists. An absent control is never a control.

## D-C7B-04 — Series, proposals and immutable revisions held by the datastore (Technical Lead / executor, C7-B)

- A **series** is one family on one exact canonical scope (immutable identity). A **revision** is append-only: revision
  n+1 of its series with `prior_revision_id` = the current one (compare-and-swap: a stale, skipped, rolled-back or second
  current revision is refused by `app_control_revisions_sequence` + `UNIQUE (series_id, revision)` under BEGIN
  IMMEDIATE); a RELEASE needs a live SET; an identical SET is no change.
- The proposal fingerprint binds family, scope, operation, value, reason, evidence and the expected revision; any
  material change is a new act (new review, new approval).
- Datastore gates (TypeScript bypassed): the closed family catalogue; seat + R3 grant + admitted scope on every proposal;
  forward-only proposals; `app_control_revisions_r3_governed` (exactly the AWAITING_FOUNDER proposal, a SATISFIED R3
  ACTION review of that fingerprint never decided by the maker, an APPROVED R3 approval of that fingerprint decided by the
  issuing Founder); `app_control_revisions_conform` (family scope kinds, opaque scope identifiers, exactly the family's
  typed value, no repeated key, Remote Configuration only under an approved register family, Route Hold only HELD);
  append-only revisions and series.

## D-C7B-05 — The App Operations & Release Lead seat (Technical Lead / executor, C7-B)

Migration 0013 creates the seat `product.app-operations-release-lead` (LEAD, Product, reports to `director.product`,
`CANONICAL_MAP`, ACTIVE, vacant) and a new Product charter version listing it (the previous version superseded, never
edited; BASELINE stays BASELINE). The App Store Release & Reputation Lead seat is untouched. No Employee, assignment,
persona, model or grant is created.

## D-C7B-06 — Approved Remote Configuration: an empty, release-only register (Technical Lead / executor, C7-B)

A future family is one typed value (BOOLEAN, bounded INTEGER or a closed code ENUM — never free text, JSON, expression,
script or prompt) with its allowed scopes and its Product Owner + Architecture approval references
(`assertRemoteConfigFamily`; `app_remote_config_families`). The production register is empty in code and datastore; a
runtime insert is refused (`app_remote_config_families_release_only`): a later controlled release adds a family in its
own migration without redesigning the plane. Until then every Remote Configuration fails closed with
`NO_APPROVED_REMOTE_CONFIG_FAMILY`.

## D-C7B-07 — Bounded refusal counters close the Company-side part of R-C7A-04 (Technical Lead / executor, C7-B)

A refused intake (and a repeated conflicting replay) is counted in `external_intake_refusal_windows` per (registered
source id or `unresolved`, reason code, hour window); only the first of a window is audited. Keys never come from a
producer-supplied string (datastore trigger); nothing of the refused payload is stored; no timer runs; accepted intake is
unchanged; source health counts the counters (history before 0013 folded in from the audit). The window length is
engineering policy. Network / edge rate limiting and DoS protection are NOT solved here: L1 / App-side Production
Integration own them.

## D-C7B-08 — Proofs, verifier, mutation and CI for C7-B (Technical Lead / executor, C7-B)

Proof markers `C7B-PROOF: control-kernel` (governance) and `C7B-PROOF: storage-control-plane` (storage);
`scripts/c7b-mutation-check.mjs` (33 mutations, 42 after D-C7B-09/10, pinned; Windows 3 shards, Ubuntu 2); verifier rules
`c7b-not-claimed-closed`, `c7b-proofs-present`, `c7b-control-plane-governed`, `c7b-no-generic-execution`,
`c7b-roles-separate`, `c7b-intake-refusals-bounded`; `c7-later-scope-not-leaked` now confines the control-family
vocabulary to the C7-B modules and keeps C7-C / C7-D out entirely; 0012 joins the frozen migrations.

## D-C7B-09 — Authority is re-decided at the issue boundary (Technical Lead exact-head review of PR #14, MAJOR 1)

The production-impacting act is the issue, not the proposal: `proposal → independent review → Founder approval → issue`
can span days, and the proposer may lose the App Operations & Release Lead seat, its acting coverage may end, or the R3
grant may be revoked or expire meanwhile. Decision: the issue transaction re-decides the proposer's authority NOW
(`issueAuthorityProblem`, inside `assertIssuable`, so the governed preview refuses an APPROVE exactly as confirm does):
the Employee may still act (`canExecute`), still holds the seat it proposed from (or acting coverage naming
`control.propose`, current at the issue instant), and the very grant the act was decided under (`grant_id`) is still
ACTIVE, unexpired, Founder-created R3 `app-control.issue` and still covers the family. The grant's `uses` is NOT
re-tested: its one use was consumed by this act at proposal time, and consumption by the act is not a loss of
authority (proved with a single-use grant that still issues). A refusal is whole (`AUTHORITY_DENIED` with the reason
code; nothing issued, the approval stays PENDING, the review SATISFIED, the history unchanged); the Founder may still
REJECT the act. The datastore holds the same invariant without TypeScript (`app_control_revisions_authority_current`).

## D-C7B-10 — A STALE review never strands a control proposal nor keeps its approval alive (TL exact-head review of PR #14, MAJOR 2)

The existing Review Plan lifecycle supersedes a plan and makes its open / satisfied requests STALE (Stage 11; R2-02).
Before this decision a control proposal kept pointing at its STALE review (and an AWAITING_FOUNDER one kept a PENDING
approval resting on it), and neither an org-act replay nor `txProposeControl` re-opened a review. Decision (Option A of
the review — the same proposal is bound to a new review request under the active plan):
- Every transition of a control review to STALE (`setRequestState`) reaches `txControlReviewStale` in the same
  transaction: an approval PENDING on it is REVOKED (`app_control.review_stale`) and the proposal returns to PROPOSED
  (history `review.stale`). The stale review is never reused; the revoked approval can never issue (engine,
  preview and datastore).
- `recoverControlReviews` binds the SAME proposal (same exact act, same fingerprint — never a duplicate, no new Work
  Item) to a fresh ACTION review under the active plan (`review.rebound`), with the same integrity-checked subject its
  first reviewers saw; once that review is satisfied a NEW PENDING R3 approval of the same act is created, and only it
  issues. It runs where a control review goes stale (after the plan declaration, after the executor's own R2-02
  wake), when the exact act is presented again, and in the bounded recovery sweep. Deterministic outcomes: a fresh
  review; REVIEW_REJECTED when this exact act already drew a rework verdict (never revived); STALE when the series
  moved, the Work Item ended, or the act cannot be shown whole under the new plan; without a plan that reviews actions
  it waits, and the next plan declaration recovers it.
- The datastore: a review is replaced only once it is STALE, an approval only once it is REVOKED; AWAITING_FOUNDER →
  PROPOSED only with a STALE review and a REVOKED approval; and a proposal reaches AWAITING_FOUNDER only on a SATISFIED
  review and a PENDING approval of exactly its fingerprint (0013 `app_control_proposals_forward`).

## D-C7C-01 — C7-C Product decisions (Founder / Product Owner, recorded at the C7-C start, 2026-10-01; recorded, not reopened)

Recorded from the approved C7-C brief (§4): the Company is completed before the App and the website so the Founder can
talk with, train and observe it; **conversation comes before large execution** and conversation ≠ authority (a message
never creates / approves a Goal, grants budget, tools or authority, publishes, changes policy, activates App controls or
becomes canonical truth; silence is never approval); **no universal employee score**, ranking, leaderboard, grade,
activity-count productivity or blended company score — Employee evidence stays exactly the eight C6 dimensions and
"appropriate autonomy" is evidence under JUDGMENT + INDEPENDENCE (no ninth dimension; legitimate clarification is not
negative); outcome before activity; **internal quality ≠ market success** (`TRAINING_INTERNAL` proves capability and
discipline only; `CONTROLLED_REAL` market claims come only from current governed C7-A evidence; absence of external
evidence is not failure unless the Pilot requires it; an issued C7-B control is never an outcome); the **Founder remains
final authority** (Pilot evidence is advisory: supported / insufficient / concern / contested; it never promotes,
demotes, terminates, expands authority, declares production readiness or closes Strong v1).

## D-C7C-02 — A Pilot is a context, not a second engine (Technical Lead / executor, C7-C; architecture gate)

- The mechanism census (C7-C report §5) found every Pilot need already served: C5 threads, governed reply Work Items and
  the pending-reply predicate; C5 Goals, Founder approval, Department derivation and Goal → Work links; the C6 kernel
  (`buildPerformanceProfile`, `costPerQualifiedOutcome`, attribution standing) whose storage reads already accept a Work
  Item set; C6 inspection; C7-A current verification truth; the C7-B proposal records; Founder Attention; the governed
  confirmation. So C7-C stores only what nothing else holds: a Pilot's identity, mode, lifecycle and two bindings.
- Migration 0014: `pilots` (mode, title as Company content, `requires_external_outcome`, state, `briefing_thread_id`,
  `root_goal_id`, created by the Founder, version, timestamps) and `pilot_history` (one row per step, Founder actor,
  matching the Pilot's version and state). The bindings are columns, each written once (a link table would add a second
  identity for the same fact); two partial unique indexes make one Pilot per thread and per root Goal. No events
  aggregate (like the other C5 Founder stores, a Pilot step writes a content-free audit row; the surface is told through
  the runtime's signalling). Datastore gates: born DRAFT, immutable identity / mode / title / bindings, forward-only
  steps (terminal never revives), the briefing binding (an open Founder ↔ CEO thread, entering BRIEFING), READY only
  with briefing evidence, ACTIVE only on a qualifying root Goal, no hard delete, append-only history.
- Every Pilot write is the Founder's own act through the C2 chokepoint (`founderAdminWrite` + `founder()`; Employees,
  delegates and references are refused), in one `BEGIN IMMEDIATE` with its history and audit. A Pilot grants no budget,
  tool, role or authority, and no metric, message or Employee ever moves it.

## D-C7C-03 — The pre-execution briefing reuses C5 (Technical Lead / executor, C7-C)

Entering BRIEFING binds an existing open Founder ↔ CEO thread, or opens one through the existing `txOpenThread`; a
Pilot-opened thread carries the context `DECISION` / `pilot:<id>` so the Founder's general direct CEO thread is never
silently reused as (or replaced by) a Pilot briefing (found by the C7-C storage proofs). No message body is copied.
READY needs proof that a conversation happened, never a claim about its quality: a response-required Founder REQUEST /
QUESTION / DECISION_REQUEST in that thread whose governed reply Work Item has recorded an Employee reply from its own run
(the C5 pending-reply predicate). An FYI, a Founder message alone, an Employee message that answers nothing, or time
passing never suffices; the Founder still takes the READY step explicitly. Reasoning quality is judged by normal Work / C6
evidence, not by message counts.

## D-C7C-04 — The root Company Goal and the derived scope (Technical Lead / executor, C7-C)

- ACTIVE binds exactly one root Goal: kind COMPANY, Founder-approved, ACTIVE, with success criteria, not the root of
  another Pilot. The Pilot never creates or approves it; the existing Founder Goal path does (the CEO may recommend).
- C5 gap closed (additive): the governed `GOAL_PROPOSE` preview now carries `successCriteria` (≤ 12 short lines,
  secret-scanned by the Goal store). Before, a Founder-proposed goal from the surface always had none, so no Pilot could
  have been activated from the surface.
- Scope is derived, never stored: root Goal → its Department Goals → their live Goal → Work links → the Work Items' own
  lineage (`parent_id`), bounded at 2 000 items. Ownership and scheduling stay in the Work engine.

## D-C7C-05 — The Evidence Board is a projection that reuses C6 (Technical Lead / executor, C7-C)

Sections: Pilot / briefing / scope; outcomes (lifecycle, qualified, under review, rework, blocked, failed, contested,
not achieved, completed-not-verified); review integrity (REQUIRED review states, independent vs maker decisions,
conflicts); Founder Attention items whose source lies in scope (no second notification bus); the exact decisions the
Pilot waits for; people evidence (the C6 Performance Profile on the Pilot-scoped live evaluations, attributions,
learning effects and contributions — eight dimensions, C6 sample / confidence / level / trend / attribution rules;
people listed by id, never ordered by a measure); autonomy; collaboration (delegation records, departments, unresolved
handoffs — message volume is observability only); learning (signals → lessons → interventions → systemic findings of
scoped work); economics (`costPerQualifiedOutcome` over every scoped evaluation: failures and overhead included); external
outcomes (C7-A current truth); C7-B proposals as desired-state context; the readiness checklist; observability. Outcome +
trace: `inspect(pilot, workItem)` returns references into the canonical lineage (work item, runs, reviews, delegations,
approvals, tool invocations, evaluation, attribution, learning signals, external bindings, control proposals) and where the
trace points (result, tool, handoff, escalation, review, model / provider, context, workflow, requirement, external
dependency); accountability comes only from a VALIDATED C6 attribution — C7-C never blames.

## D-C7C-06 — Appropriate autonomy is JUDGMENT + INDEPENDENCE (Technical Lead / executor, C7-C)

Per item, from its C6 verdicts only: an authority-boundary refusal (JUDGMENT NEGATIVE) is never positive; a correct
escalation (JUDGMENT POSITIVE, CORRECT_ESCALATION) is good judgment, never dependence; Founder intervention the work needed
(INDEPENDENCE NEGATIVE) is evidenced dependence, counted against an Employee only through C6 attribution; a qualified
outcome without intervention or a proven different route is routine work handled independently; otherwise insufficient
evidence. Clarification requests are read by no dimension, so they are never negative. Inside a Pilot an item whose own
JUDGMENT is NEGATIVE contributes no POSITIVE INITIATIVE (an attempted unauthorized act is never initiative); the
employee-wide C6 profile is unchanged (see residual R-C7C-04).

## D-C7C-07 — Readiness is an advisory checklist (Technical Lead / executor, C7-C)

Eight criteria, each with its own state (`INSUFFICIENT_EVIDENCE` / `SUPPORTED` / `CONCERN` / `CONTESTED`, and
`NOT_APPLICABLE` only for the real-world criterion of a training Pilot), bounded params and evidence refs, `isDecision:
false`; nothing is weighted, averaged or summed. No new numeric thresholds were invented: states follow C6's own
evidence semantics (sufficiency, accountable negatives, pending attribution, IMPROVEMENT_OBSERVED, cost per qualified
outcome DEFINED / NO_QUALIFIED_OUTCOME). Pilot success thresholds and objective windows are a Founder decision (R-C7C-01).

## D-C7C-08 — C7-A and C7-B at the Pilot boundary (Technical Lead / executor, C7-C)

A market claim exists only for CONTROLLED_REAL: SUPPORTED only through qualified outcomes whose CURRENT verification cites
usable governed external evidence; any in-scope verification a later integrity conflict CONTESTED makes the claim
CONTESTED at once; the Founder's C7-A resolution (uphold / replace / retract) is followed as current truth; history is
never rewritten. A training Pilot never claims market success, even with evidence. C7-B proposals in scope are shown as
counts by state with `desiredStateOnly: true`, `countsAsOutcome: false`, `appEffectKnown: false`; nothing in C7-C names a
control family or an App effect. No intake, connector, scraper or transport was added.

## D-C7C-09 — The Founder surface: structured intents, one read, a palette section (Technical Lead / executor, C7-C)

`PILOT_CREATE` and `PILOT_ADVANCE` are structured-only intents of the governed confirmation (preview → fingerprint →
confirm once, inside the verified session; no text pattern produces them; a preview never offers a step the confirmation
would refuse — `planPilotStep` is the same check, without effect). `SHOW_PILOT` is a read intent (EN / AR). The API adds
`GET /api/pilots`, `/api/pilots/:id` and `/api/pilots/:id/inspect`; the palette shows the Pilots, the exact decision each
waits for, a link into the CEO briefing thread, the readiness checklist in words and preview buttons for each step. No
Tree of Light redesign; Arabic titles keep their own direction and line-height.

## D-C7C-10 — Proofs, verifier, mutation and CI for C7-C (Technical Lead / executor, C7-C)

Proof markers `C7C-PROOF: pilot-kernel` (governance), `pilot-evidence-kernel` (mind), `storage-pilots` (storage),
`runtime-c7c` (runtime); `scripts/c7c-mutation-check.mjs` (25 mutations, pinned; 136 s locally; Windows 2 shards, Ubuntu
1); verifier rules `c7c-requires-c7b-closure`, `c7c-not-claimed-closed`, `c7c-proofs-present`, `c7c-pilot-governed`,
`c7c-no-c7d-or-network`; 0013 joins the frozen migrations.

## D-C7C-11 — Research refresh consequences (Technical Lead / executor, C7-C; informative sources, not authority)

DORA metrics guide: no single metric, measures in tension, context matters, metrics as targets invite gaming, team
improvement over comparison → a checklist of independent criteria, no blended number, no cross-Employee comparison or
ordering. Anthropic "Demystifying evals for AI agents": grade outcome and transcript, combine grader types, errors compound
across steps, do not punish valid creative paths → outcome + trace inspection, C6's VALID_CREATIVE_PATH kept, C7-C adds no
step-checking grader. OpenAI agent evals / trace grading: traces expose tool choice, handoff and policy problems;
repeatable evals once "good" is defined → failure localization by area over canonical refs; repeatable Pilot evals wait
for the Founder's definition of good (R-C7C-01). No vendor infrastructure imported.

## D-C7C-12 — C7-D scope clarification: Digital Presence Creation & Operations (Founder / Product Owner; recorded, not implemented)

C7-D is renamed and clarified: BUILD (research, sitemap / information architecture, UX, copy, visual direction, code,
tests, preview, SEO preparation) and OPERATE (website updates, landing pages, SEO, content, social, marketing operations,
measurement, governed external publishing). The future flow: a broad Founder Goal → research → questions → strategy →
site structure → technical proposal → design / copy / code → tests → preview → Founder decisions where required →
governed publication → real result evidence back through C7-A → C6 → C7-C. Initial external publication under the
QANDEEL name stays Founder-approved. No website framework, hosting, CMS, analytics, SEO or social vendor is preselected,
and none of this is implemented in C7-C (verifier `c7c-no-c7d-or-network`).

## D-C7C-13 — A Pilot's briefing evidence starts at its own briefing boundary (TL exact-head review of `2af37b6`, MAJOR)

An existing open Founder ↔ CEO thread may still be bound entering BRIEFING, but what it already holds never briefs the
Pilot: entering BRIEFING records `briefing_from_seq` = the bound thread's next message sequence (written once with the
binding; the datastore checks it equals `MAX(seq) + 1` at that moment). Only a response-required Founder REQUEST /
QUESTION / DECISION_REQUEST at or after that boundary, with the governed reply of that exact message's reply Work Item,
evidences READY — in `txBriefingStatus` (preview, store, board) and in `pilots_ready_requires_briefing` alike. Earlier
messages stay ordinary communication history. Mutations `c7c-briefing-boundary-dropped` (code) and
`c7c-db-briefing-boundary-dropped` (datastore); C7-C mutations 25 → 27.

## D-C7D-01 — C7-D builds capability, not the QANDEEL website (Founder / Product Owner brief; executor-recorded)

C7-D adds the Company's internal Digital Workshop, a safe internal Preview, exact Release Candidates and governed external
promotion seams. It builds no website, creates no repository, chooses no framework, hosting provider, CMS, analytics,
SEO vendor or social platform and publishes nothing; those are later Company recommendations and Founder decisions in a
real Pilot (verifier `c7d-no-vendor-preselection`, `c7d-not-claimed-closed`). GitHub is the one approved external code
host (brief §4.4), as a promotion target only, never the editing substrate. No sixth Department and no auto-hiring.

## D-C7D-02 — A Digital Project is a context; Work stays in C1 / C5 (executor)

`digital_projects` holds identity, type, title, an optional Goal, state DRAFT → ACTIVE → ARCHIVED (forward only,
append-only history) and the creating Work Item. Tasks, ownership, delegation and review stay in the existing Work /
Goal / Review systems; the C7-C Pilot is found through the project's Goal and its ancestors (a reference, never a copy).

## D-C7D-03 — Internal authoring is a closed, Company-native Tool catalogue served by the Tool Executor (executor)

Migration 0015 seeds one Tool, `digital-workspace` (egress NONE, driver code `company.digital-workspace`, reserved by
trigger), with 17 typed actions (project, revision, file put / remove, chunked upload, finalize, inspect, read, preview,
SEO check, candidate, promotion prepare / inspect). No action may be added to it and no generic filesystem, shell or HTTP
action exists. Employees need an explicit Founder grant per action (R0 reads, R1 internal acts: no review, no Founder
approval — autonomy inside the Company). The Tool Executor serves the reserved driver itself: Artifact Store I/O first
(its own fenced, crash-safe protocol), then ONE fenced transaction applies the act and records the tool result, so a
crash leaves either nothing (the orphan intent is retried under the same key) or the whole act.

## D-C7D-04 — Content lives in the Artifact Store only (executor)

A revision maps logical paths to READY content-addressed objects by id, hash and size; SQLite never holds file bytes
(no content / blob column; verifier). A read slice reaches the run's context (bounded, ≤ 1 KiB so its JSON fits the
2 048-character recent-result bound) while the durable tool history keeps only its digest. Text content is UTF-8 and
secret-scanned whole before any object is stored. Ownership and state are checked before any object is stored.

## D-C7D-05 — Revisions: working → FINALIZED (immutable, deterministic manifest) (executor)

A working revision belongs to the Work Item that opened it (edited only by its runs). Finalizing re-hashes every object,
checks bounds (≤ 2 000 files, ≤ 64 MiB, case-insensitive unique paths for Windows) and writes the manifest hash =
SHA-256 of the canonical, path-sorted entry list; the datastore re-checks the count, size and READY objects. A finalized
or abandoned revision never changes again (triggers); a change is a new revision (optionally based on a finalized one).
Logical paths refuse traversal, absolute / drive / device paths, NUL and reserved characters, credential files,
`node_modules`, VCS and OS folders, and are NFC-normalized; a logical path never becomes a host path.

## D-C7D-06 — Internal Preview on its own loopback site (executor; research §5)

Cookies are not isolated by port and SameSite ignores ports (RFC 6265, WHATWG "site"), so a preview on another port of
127.0.0.1 would receive the Founder surface's cookies. Each opened preview therefore gets its own ephemeral listener on
127.0.0.2 — a different host and site — closed when it expires (30 min, ≤ 4 open). Every response carries
`Content-Security-Policy: sandbox allow-scripts` without allow-same-origin (opaque origin: no cookies, storage or service
worker), `connect-src 'none'`, `form-action 'none'`, no frames / workers / manifests, noindex / no-store, COOP / CORP /
COEP. It reads no cookie, sets none, has no API or path, serves only the exact finalized revision's STATIC files
re-verified from the Artifact Store (source files are stored and exported, never served), refuses a foreign Host,
non-GET methods and service-worker requests, and refuses the whole preview when any object is missing or corrupt. The
Founder surface opens it with `noopener`; its existing Sec-Fetch-Site gate refuses anything the preview origin sends.
Nothing is ever built or executed on the host to make a preview work: a build-needing revision is a capability gap.

## D-C7D-07 — Release Candidates bind content; promotions bind acts; lifecycle is derived (executor)

A Release Candidate binds one finalized revision and its manifest hash (immutable; a change is a new candidate). A
promotion binds candidate × kind × Founder-registered target × the target adapter's R3 external tool action × EXACT
arguments (ids, hashes, numbers, timestamps — always the candidate id and manifest hash). Review, Founder approval and
execution are NOT stored on it: its state (PREPARED, UNDER_REVIEW, REVIEW_REJECTED, READY_FOR_FOUNDER, REJECTED,
APPROVED, EXECUTING, PROMOTED, FAILED, RECONCILIATION_REQUIRED, STALE) is derived from the canonical review request
(matched by the exact arguments its subject records), the approval and the tool invocation (matched by Work Item, tool
action and argument hash). The existing C2 path therefore gives every promotion an independent Review Pool review of the
exact act (the maker never reviews it) and the Founder's approval of exactly its arguments (APPROVAL_DECIDE, enriched
with the candidate summary, kind and target). Export approval never authorizes production (another action, another
fingerprint); one post never authorizes another. One live act per candidate × target × kind: the same terms are
idempotent, other terms are refused while it lives, and a rejected / reworked act never regenerates for the same
candidate (a changed candidate is the way forward). A driver resolves its content at execution time from the exact
approved arguments, re-verified (argument hash, adapter, target, manifest recomputed, every object re-hashed).

## D-C7D-08 — GitHub code-host adapter (executor; research §1)

A private GitHub App: a fresh installation token per call (JWT signed with the App key obtained at the protected
boundary through a `vault:` reference), scoped to ONE repository and exactly `contents: write, pull_requests: write,
checks: read, statuses: read, metadata: read` (a broader grant fails closed); host-configured repository allowlist plus
the Founder-registered target; a closed endpoint allowlist (no DELETE / PATCH, no admin, protection, secrets,
collaborators, hooks, keys, environments, actions), one fixed host, no redirects. Effective branch rules are read through
`GET …/rules/branches/{b}` (Metadata), never the Administration-only protection endpoint. Export: blobs → a tree that is
exactly the candidate (no base tree) → one commit with provenance trailers → a NEW branch (created, never updated or
forced) → one pull request; replay returns the same refs. Production merge is a separate R3 act bound to the exported head:
only when `mergeable_state` is `clean` and every check on that head completed green, merged with the `sha` guard (GitHub
refuses a moved head with 409). Failure before the branch exists is `sent: NO`; from the branch creation / merge call on,
an unanswered call is `sent: UNKNOWN` → reconciliation, never a blind retry; `promotion-reconcile` reads the Company's own
effect as evidence for the Founder's existing TOOL_RECONCILE decision. Pinned REST version `2022-11-28` with its announced
end of support 2028-03-10 (fail closed after it; `2026-03-10` is the newer version to evaluate in a later change).

## D-C7D-09 — Hosting / CMS and social seams; no provider (executor; research §2, §4)

A hosting / CMS adapter declares external preview, production publish, production rollback and state read as DISTINCT
actions (refused otherwise) and plugs a provider port with four distinct operations; a rollback is bound to the exact
current production version. A social adapter declares a pinned API version and sunset, content types, permissions,
account / page roles, edit / delete semantics, asynchronous publish and rate limit; its driver gate checks the identity's
CURRENT permissions and roles, the version, the content type and that NOW is inside the exact window the approval bound,
before any provider call; one post per promotion (stable key); an asynchronous answer is SUBMITTED, not "published".
No comment, reply, DM, paid-spend or ad act exists. No provider is implemented.

## D-C7D-10 — SEO readiness is mechanical; scheduling reuses the calendar; publication is not an outcome (executor)

The SEO lint (mind) reports findings and tallies only — titles, descriptions, canonical consistency, robots / noindex /
sitemap contradictions, crawlable links, alt text, language, viewport, hreflang syntax, structured-data syntax, route
status intent, client-rendered pages — never a score, likelihood, volume or position; search performance needs governed
C7-A evidence. Approved publication windows appear on the existing Company Calendar projection; execution is an ordinary
Work Item inside the window (the queue already holds time); there is no second scheduler. Digital evidence reaches the
C7-C Pilot board as counts and states only; a provider confirmation never counts as an outcome or market success, and
C7-D writes no evaluation, attribution, learning or external evidence.

## D-C7D-11 — New package `@qandeel-company/tool-drivers`; two reviewed network paths (executor)

External Tool drivers live in a real subsystem package (GitHub driver, auth, endpoint allowlist, fixed-host HTTPS transport,
a deterministic fake GitHub for CI, hosting and social seams). It depends only on domain and governance; it never reaches
the store, the runtime, SQLite, the filesystem or processes (a driver receives only its resolved candidate through the
host-wired promotion source). The only network paths added are the isolated Preview host and the GitHub HTTPS transport
(ESLint and verifier exceptions, each with its own rules). Driver unit tests call `invoke` directly; production code still
reaches drivers only through the Tool Executor. The deterministic fake provider gains `"$ref:<action>.<field>"` script
arguments so multi-step scripts can use ids the Company issued.

## D-C7D-12 — Research refresh consequences (executor; informative sources, not authority)

GitHub docs (Apps vs PATs, installation tokens, permissions, protected branches / rulesets, merge `sha`, API versions),
Vercel / Cloudflare preview-vs-production patterns (immutable per-commit artifact, protected noindex previews, promote the
verified artifact, rollback to a prior production artifact), Google Search Central (crawlable links, canonical as a hint,
noindex needs crawlability, sitemap limits, JavaScript SEO, people-first content, Search Analytics as real evidence),
LinkedIn Posts API and Instagram content publishing (dated versions with sunsets, role-based posting, asynchronous publish,
container expiry and publish quotas), RFC 6265 / WHATWG / MDN (cookies ignore ports, site ignores ports, CSP sandbox
opaque origin). Consequences are D-C7D-06 … D-C7D-10. No vendor architecture imported.

## D-L1-01 — DeepSeek-V4.1-Flash (`deepseek-flash`) is the initial LLM brain (Founder decision; executor-recorded)

The Founder selected DeepSeek-V4.1-Flash as the Company's initial provider and model, with the API alias `deepseek-flash`
and the initial pilot mapping E1 → thinking none, E2 → low, E3 → high, E4 → max. L1-01 adds no second provider, no
DeepSeek Pro fallback, no DeepSeek tools, no voice, no APP-OPS transport and no unlimited budget. Official research
refresh (2026-10-05, `https://api-docs.deepseek.com/`: pricing, create-chat-completion, error codes, thinking mode,
list-models, JSON mode, the 2026-09-10 release note and the change log): `deepseek-flash` names DeepSeek-V4.1-Flash
(released 2026-09-10; `deepseek-v4-flash` is retired and temporarily routed to it); base `https://api.deepseek.com`,
Bearer auth, `/chat/completions` with `thinking: { type }` plus a top-level `reasoning_effort: low | high | max`
(corrected by D-L1-10; the first draft nested the effort inside `thinking`) (default thinking
on at `high`), `max_tokens` 1..393 216 (defaults 8K non-thinking / 64K thinking), usage `prompt_tokens`,
`completion_tokens` (reasoning tokens included; `completion_tokens_details.reasoning_tokens`), `prompt_cache_hit_tokens`,
`prompt_cache_miss_tokens`; `GET /models` returns the display `name`; error codes 400 / 401 / 402 / 422 / 429 / 500 / 503;
pricing (per 1M tokens, USD) cache miss $0.30 peak / $0.15 off-peak, cache hit $0.006 / $0.003, output $1.20 / $0.60,
peak = 01:00–04:00 and 06:00–10:00 UTC Monday–Friday excluding Chinese public holidays. Two facts the docs do not state
are recorded as residuals, not assumed: whether `max_tokens` bounds thinking tokens, and whether the band is decided by
request or completion time (L1 settles at the settling transaction's clock, seconds after completion).

## D-L1-02 — Windows user-scoped secret vault: DPAPI through the signed PowerShell host (executor; Stage 14 D14-A.5 / D14-D.5)

`@qandeel-company/secret-vault` is a real subsystem. A reference is `vault:<name>`; a value exists only inside `use()`'s
callback for one call. The Windows vault protects each secret with built-in DPAPI (`ProtectedData`, `CurrentUser` scope,
fixed application entropy for domain separation) and stores the protected blob under `%LOCALAPPDATA%\QANDEEL_COMPANY\vault`
— outside every workspace, backup and checkout. Pure JavaScript on the signed Node runtime cannot call DPAPI, so the
vault starts the signed Windows PowerShell 5.1 host by its absolute System32 path with a fixed argument list, no shell,
and passes the payload on stdin only. This is the ONE reviewed process path in the repository (ESLint exception and
verifier rule `l1-vault-protected`): it opens no network path and reaches no SQLite. `qandeel-vault set <name>` prompts
on an interactive terminal without echo, refuses `--secret` / `--value` / `--key` / a second positional argument before
anything else, refuses a piped stdin, overwrites only with `--replace`, and never prints a value. CI uses the in-memory
vault. No third-party password manager, no native addon; Smart App Control stays on. Rejected: an environment variable
(process-wide, inheritable, visible in diagnostics) and a plaintext file (no OS protection).

## D-L1-03 — The DeepSeek adapter extends the existing provider boundary; the reasoning class travels with the request (executor; Stage 13 D13-A/D13-F)

`@qandeel-company/model-providers` holds the adapter behind the unchanged `ProviderAdapter` contract: the governed Model
Runtime stays the only caller of `generate`; the adapter has no Company authority, Work, budget or tool. One fixed origin,
a closed two-endpoint allowlist, `redirect: 'error'`, bounded request / response bodies, `stream: false`, no `tools`, no
temperature; JSON output mode because the Company's proposal contract is one JSON object. `ProviderRequest` gains
`reasoningClass` (provider-neutral; the adapter maps E1–E4 to its bounded thinking profiles) and `ProviderUsage` gains
`cachedInputTokens` (a metering extension validated at the boundary: a subset of input, else UNUSABLE). Company `tool`
messages are presented as user messages (the provider's own tool protocol is never used). Only `choices[0].message.content`
and `usage` are read: no thinking / chain-of-thought field is ever read, returned, logged or persisted (the verifier
forbids the field name outside comments in every src module). Errors normalize to the taxonomy (400 / 422
INVALID_REQUEST, 401 AUTH, 402 BILLING, 429 RATE_LIMITED, 500 TRANSIENT, 503 CAPACITY, abort / timeout
TIMEOUT_AFTER_SEND, connection refused / unresolved TRANSIENT, other transport failure UNKNOWN, malformed / oversize /
other-model / inconsistent cache usage CONTRACT_VIOLATION, `content_filter` CONTENT_POLICY, `insufficient_system_resource`
CAPACITY) with no provider text; the adapter never retries. The documented occasional empty JSON-mode content is returned as
the provider's (empty) answer, which the proposal layer refuses as invalid output (one evidence-based escalation), rather
than as a contract violation that would hold the only pilot deployment.

## D-L1-04 — Truthful provider billing: price schedules on the immutable card, worst-case reservation, actual settlement (executor; Stage 13 D13-G.2/.3/.5)

The fixed `PriceCard` could not represent cache-hit / cache-miss and peak / off-peak billing, so the smallest
provider-neutral extension was made: a card may carry `billedCachedInputPerMTok` and a `PriceSchedule` (off-peak rates,
UTC peak windows, peak weekdays, published holiday dates, basis source URL and date), persisted in `price_card_schedules`
(migration 0016) as part of the immutable, versioned card; the datastore refuses a schedule that discounts above the card's
rates or on a non-METERED card. The card's base rates stay the PEAK, all-cache-miss rates: `worstCase` / routing /
reservation are unchanged and never discount. Settlement computes `actualCost` (cache-hit input at the cached rate, miss at
the fresh rate, output, each at `billingBandAt` the settling transaction's clock) and records `billed_micros`,
`cached_input_tokens` and `billing_band` on the usage row; `economic_micros` keeps the card's flat economic rates (the
Company's governed cost; never a provider discount), so economic ≥ billed for every METERED card. A price change is a new
card version; historical usage never changes. The DeepSeek basis (2026-10-05) pins the 2026 PRC public holidays from the
State Council's 2025-11-04 notice (during the UTC peak windows the UTC date equals the Beijing date). No broad C2 rewrite
was needed: `txSettle`, reservations, budgets and routing are untouched.

## D-L1-05 — Alias drift fails closed; identity checks are system facts (executor; Stage 13 D13-B.6)

`deepseek-flash` is an alias, not a pinned revision. `GET /models` is the qualification check: id = `deepseek-flash`
and `name` = `DeepSeek-V4.1-Flash` is MATCH; another name is DRIFT. The adapter checks before its first call and after
each identity TTL (one hour) and refuses to call a drifted alias with MODEL_DEPRECATED (the existing disposition holds
the deployment for requalification; nothing is sent to the unqualified model). The operator's `qandeel-founder
provider-check` records the content-free verdict (public name and limits only) in `model_identity_checks` (append-only; a
system fact, never Founder authority); provisioning needs a MATCH at most 7 days old for the expected name. Deployments
are pinned to the revision label `v4.1-flash-alias-2026-09-10` so a requalified alias is a new immutable deployment.

## D-L1-06 — Governed provisioning: release-pinned profiles confirmed by the Founder (executor; task §13)

A `ProviderProvisioningProfile` is provider-neutral DATA (governance kernel): provider, one model identity, one
immutable deployment profile per reasoning class with conservative Company-side limits (E1 64K / 4K, E2–E4 128K /
16K–64K; never the provider's 1M / 384K), the versioned pricing basis, the egress ceiling (an external profile never
exceeds D2) and the pilot route policies. `GovernanceStore.provisionProviderProfile` registers it through the existing
catalog APIs (provider → model → deployments → price cards → one qualification step at a time to LIMITED_PRODUCTION →
egress → route policies) and creates the first bounded Company cap when none exists; it never re-provisions and needs the
fresh MATCH check. The Founder reaches it only through the structured-only `PROVIDER_PROVISION` intent of the governed
confirmation (`founder_action_previews` is recreated with the extended intent catalogue in 0016, the 0011 / 0012 / 0014
precedent): the preview shows the deployments, the peak reservation rates, the egress ceiling and the exact cap before
anything exists, and the confirm executes inside its one transaction. The host registers profiles
(`qandeel-founder serve --provider deepseek`); the UI offers them on the `SHOW_PROVIDERS` read. No direct SQL
provisioning; no Founder authentication in a terminal. The seam-seeded L1 harness uses the same store method.

## D-L1-07 — A Founder-thread reply is told the MESSAGE proposal shape; FINAL after a recorded message (executor; C3 / C5 seam)

A real model could not answer the Founder: the assembler's preamble listed FINAL / TOOL_REQUEST / MEMORY_CANDIDATE
/ OBSERVATION only (the deterministic fake was scripted). The preamble of a Founder-thread reply Work Item (the one
whose immutable processor input binds `founderThreadId`, created by `CommunicationStore.send`) now carries one extra
line: the MESSAGE shape, the Founder's language, that a message decides nothing, to output the one JSON object alone,
and to propose FINAL once the message appears as recorded in the recent results. Every other Work Item keeps its exact
pre-L1 preamble: context estimates are byte upper bounds, so a general prefix growth would tax every budget (the C3
"long loops never fail" proof runs at 4,000 tokens and sat 79 bytes under it), and no Employee is invited to message
the Founder from unrelated work. No routing, authority or budget rule changes.

## D-L1-08 — Validation: focused proofs, one L1 mutation shard, verifier rules; the live smoke is a Founder-host harness (executor)

Proof markers `L1-PROOF: secret-vault`, `deepseek-adapter`, `economics-bands`, `storage-pricing`, `runtime-l1`;
`scripts/l1-mutation-check.mjs` (one shard per OS; the suite is small); verifier rules `l1-requires-c7d-closure`,
`l1-proofs-present`, `l1-vault-protected`, `l1-provider-boundary`, `l1-pricing-truthful`; 0015 frozen; the two new
packages allowlisted. `scripts/l1-deepseek-smoke.mjs` is NOT a CI step: it needs the Founder's vault entry, the
network and a tiny bounded spend, seeds identities through the test-only seam (as every acceptance does) and drives the
real runtime with the real adapter; the production path for the first CEO (hire → Academy → activation through the
Founder surface) is recorded as the next L1 seam, not bypassed.

## D-L1-09 — A thread-bound run ends when its message is recorded: the runtime, not the model, guarantees one answer (executor; C2 / C5 seam)

The first live run (DeepSeek-V4.1-Flash at E1, thinking disabled) answered the Founder with a well-formed MESSAGE,
saw it recorded in its next context, and still proposed a new MESSAGE on every turn until `MAX_CALLS_PER_RUN`
(4 messages in the Founder's thread, 4 billed calls, then RUN_LIMIT and a FAILED reply item). A prompt instruction
("propose FINAL once recorded") is advice a model may ignore; the deliverable of a Founder reply or a CEO brief is
one message, so the executor now ends the run as COMPLETED (`reply.sent` / `brief.sent`, the message id in its
evidence) as soon as the fence records that message. A REFUSED message (no thread binding, a malformed brief, secret
material) keeps today's loop. The proof's fake model now never proposes FINAL and the mutation
`l1-recorded-message-does-not-end-run` shows the gate is real. No routing, authority or budget rule changes; the
Founder-thread guidance says "one MESSAGE is the whole answer: the run ends when it is recorded".

## D-L1-10 — The official thinking wire shape: `thinking: { type }` plus a top-level `reasoning_effort` (executor; PR #17 review BLOCKER)

The first adapter draft nested the effort inside the thinking object (`thinking: { type: 'enabled', reasoning_effort }`),
and its proofs encoded that same shape, so a green gate could not see the defect. The official thinking-mode guide
(`api-docs.deepseek.com/guides/thinking_mode`, OpenAI-compatible format) carries the switch in `thinking: { type }`
and the effort as the TOP-LEVEL request field `reasoning_effort: low | high | max`; nested, the provider ignores it and
E2 / E3 / E4 would silently think at the default effort while the Company reserved and billed for the class it
believed it chose. The adapter now sends the official shape (E1: `thinking.disabled` and no effort field at all;
E2 / E3 / E4: `thinking.enabled` + top-level low / high / max), `reasoning_effort` is an allowlisted request field,
the proofs assert the exact wire JSON for every class, two mutations (`l1-reasoning-effort-nested-in-thinking`,
`l1-reasoning-effort-not-allowlisted`) and the verifier rule `l1-provider-boundary` refuse the nested or unlisted
shape, and `provider-check --probe --probe-class E2` sends one bounded thinking probe (a 1,024-token ceiling that also
bounds the thinking tokens) so the corrected contract is qualified live before any governed thinking call. No routing,
pricing, egress or authority rule changes; E1 (the pilot's live class) is unaffected on the wire.
