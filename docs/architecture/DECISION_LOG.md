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
  (local IPC with caller identity, Stage 12 §48–49) is C5. The engineering API and CLI accept the
  registered Founder reference as the actor. Model output can never reach these entry points: no
  proposal type exists for them.

## D-C2-05 — Employee activation and execution eligibility

**Decision.**
- **Only `ACTIVE` executes.** `SHADOW`/`PROBATION` execution is Academy-controlled (C3) and is not
  granted here.
- **Evidence refs, not certification.** Entering `ACTIVE` requires qualification evidence
  references, and a CHECK refuses an `ACTIVE` row without them. C2 records those refs as
  Founder-attested opaque references and never claims they prove certification (C3).
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
- **Automatic pause.** Three authority denials inside one run pause the Employee (`PAUSED`,
  `AUTO_PAUSE_AUTHORITY_DENIALS`, audited). This is deterministic containment (Stage 3 §9,
  D14-E.5): it only reduces autonomy.
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
