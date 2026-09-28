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
  support prose about passwords / keys / PINs in English and Arabic is not refused. HTTP Basic
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
**Documentation note (R1 B-F6).** D-C2-07's first bullet list says an orphaned NONE / IDEMPOTENT tool
intent's reservation "is released". D-C2-12 (MAJOR, "interrupted tool intents released money that may
have been spent") amended that to "charged (`FAILED_CHARGED`), never released", and the code follows
D-C2-12. D-C2-07 is read with that amendment; it is not rewritten here.

**State.** R1 is a closure candidate awaiting Technical Lead exact-head review; it is **not closed**.
C4 is not started.
