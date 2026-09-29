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
