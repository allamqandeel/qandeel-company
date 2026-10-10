# P1-DESKTOP-UPGRADE-CORR-01 — Permanent cross-version Desktop update correction

**Status:** corrective PR candidate. It is not merged and not deployed, and nothing touched LIVE. Decision record: D-P1-07
in `docs/architecture/DECISION_LOG.md`. Production stays on release `e4f2fb2f` until a separate, approved deployment. The
verified LIVE backup `29048b38-bf05-48e7-bb10-8743baece0ae` and the earlier LIVE evidence and snapshots were not touched.

## 1. Root cause and affected code

The approved LIVE update to `4b8f189` was refused at the dry run (`DRY_RUN_FAILED`) before any change. PR #32 is the
first release that carries a schema migration through `desktop-local-install`.

| Where | Defect |
|---|---|
| `command-center/src/cli.ts` `release-check` | It opens with `migrationMode: 'verify'`, which refuses pending migrations with `SCHEMA_NOT_READY`. It accepted only `SCHEMA_UPDATE_REQUIRED`, which verify mode never throws, so every release that carries a migration failed its dry run. |
| `command-center/src/host/release.ts` backup step | The same dead mapping: `BY_SAFE_UPGRADE` was unreachable. |
| `command-center/src/host/lifecycle.ts` discovery | The same dead mapping, so the Company was reported `UNHEALTHY`. **It also read the supervisor lease through the refused open**, so a newer release lost the running older host (`leaseLive: false`, no instance). Fixing the code alone would have skipped the controlled stop. |
| `host/release.ts` rollback | After safe-upgrade migrated forward, it restored the old pin and reported `ROLLED_BACK`, although the previous release cannot open the migrated Company (`SCHEMA_FROM_FUTURE`). |

The defect was reproduced locally with the genuine predecessor release `e4f2fb2f` and the shipped release `cb3ef342`:
`DRY_RUN_FAILED`, with the running host reported `UNHEALTHY` and `leaseLive: false` (§4).

## 2. The correction (one coherent change; no second mechanism)

- **storage: `inspectCompanySchema`.** One read-only inspection.
  - It checks the history exactly as every open does. `pendingMigrations` was extracted from `migrate`, which now calls
    it, with unchanged behaviour.
  - Refusals keep their codes: `SCHEMA_FROM_FUTURE`, `STORAGE_INVARIANT`, `MIGRATION_CHECKSUM_DRIFT`, `SCHEMA_NOT_READY`,
    and a live restore.
  - It returns `CURRENT` or `UPDATE_REQUIRED`, with the lease holder from the 0001 tables.
  - It never creates, migrates or writes, and exports no connection or SQL.
- **Discovery.** It reads the lease through that inspection. A running older host stays `RUNNING`, with
  `schema: UPDATE_REQUIRED`. `UPDATE_REQUIRED` is a state only when nobody holds the Company.
- **Dry run.** It reports the schema as the release reads it.
- **Activation, when an upgrade is required:**
  - `PREVIOUS`: the pinned previous release is verified byte for byte and bound to the pin.
  - `STOP`: the running host is stopped by the previous release's own `stop`.
  - `LEASE`: the released lease is proven by this release's own reading; a crashed holder's lease is waited out, bounded
    at 45 s.
  - Otherwise the activation refuses before anything is backed up, pinned or migrated.
  - `BACKUP = BY_SAFE_UPGRADE`: the existing safe-upgrade inside the new host's start, with its pre-update snapshot,
    rehearsal, verification, journal and `UPDATE_HOLD`.
  - `HEALTH` also requires the host to read its schema as current. `SCHEMA` records `21->22`.
  - A same-schema activation is unchanged step for step.
- **Truthful failure:**
  - **Migrated forward.** The outcome is `RECOVERY_HOLD` (`SCHEMA_MIGRATED`). The pin stays on the only release that can
    open the Company, the snapshot is kept, no hold is cleared and no work is discarded. The way back is the existing
    `rollback-update`, a Founder decision.
  - **Unchanged schema.** The previous pin is restored. A held Company is not started and is `RECOVERY_HOLD`
    (`UPDATE_HOLD`). A previous host that does not return is `RECOVERY_HOLD` (`PREVIOUS_HOST_NOT_RESTARTED`).
  - **`ROLLED_BACK`** means only that the previous release runs the unchanged Company again.
  - The Desktop install reports `UPDATE_RECOVERY_HOLD`, with a fixed Founder notice.

Unchanged: migrations 0001–0022, safe-upgrade, backup and restore, the hold semantics, the force-stop policy
(operator-only), product behaviour, UI, Employees, budgets and permissions.

## 3. Acceptance scenarios

| Scenario | Result | Proof |
|---|---|---|
| Same-schema Desktop update | Unchanged: same steps, `ACTIVATED`, failed dry run changes nothing, failed start `ROLLED_BACK` | `founder-host-release` (unchanged, passing) |
| 21 → 22, previous host stopped | `ACTIVATED`; `STOP: NOT_RUNNING`, `LEASE: RELEASED`; data identical | `p1-desktop-upgrade` |
| 21 → 22, previous host running | Its own release stops it (`STOPPED`), lease proven, safe-upgrade, one new READY host, pin + previous, schema 22, journal `ACTIVATED`, snapshot kept, data identical | `p1-desktop-upgrade`; genuine `e4f2fb2f` (§4) |
| Previous host cannot be stopped | A squatter on its port means the stop never reaches it: `HOST_NOT_STOPPED` before any change; host, schema, pin and maintenance untouched; PID never terminated | `p1-desktop-upgrade` |
| Invalid or mismatched previous release | `PREVIOUS_RELEASE_INVALID` / `PREVIOUS_RELEASE_MISMATCH` before the stop | `p1-desktop-upgrade` |
| Missing, stale or mismatched host identity | Missing descriptor: refused, no stop, no second runtime. Squatter: refused. Crashed holder (live lease, PID gone): the lease is waited out, then updated | `p1-desktop-upgrade` |
| Corrupted migration history | `MIGRATION_CHECKSUM_DRIFT` / `STORAGE_INVARIANT`; at activation, `DRY_RUN_FAILED` with nothing changed | storage inspection test; `p1-desktop-upgrade` |
| Schema newer than runtime | `SCHEMA_FROM_FUTURE`: activating the older release is refused at its own dry run, and the running host is untouched | both tests; genuine `e4f2fb2f` |
| Migration rehearsal failure | Live never migrated (schema 21), data identical, journal `UPDATE_HOLD`, the hold kept and the host not started: `RECOVERY_HOLD` | `p1-desktop-upgrade` |
| Failure after the migration | `RECOVERY_HOLD` (`SCHEMA_MIGRATED`), never `ROLLED_BACK`; pin kept, previous recorded, snapshot kept, data intact; the previous release reads `SCHEMA_FROM_FUTURE` | `p1-desktop-upgrade` |
| Successful update | One host, `RUNNING`/`READY`, schema `CURRENT` (22), the new pin with the previous release as its rollback point | both |
| Business data comparison | Every Work Item, Employee and the Company budget are byte-identical before and after (JSON of full records) | every update scenario |

The integration test uses real frozen releases and real host processes. The older release is the staged build with its
last migration withdrawn (pins and file): a genuine schema-21 runtime and host, started from its own release. The CI test
does not mock the error codes.

## 4. Real cross-version proof with the genuine predecessor (local; disposable)

The genuine frozen predecessor `e4f2fb2ffa21ffd7` is PR #31's CI artifact, staged under `E:\QANDEEL_D2`, not LIVE. It
created, seeded, activated and ran a Company. The new release was staged from this branch. `LOCALAPPDATA` was redirected
into scratch: no Founder install, Apps entry or LIVE file was used.

| Step | Result |
|---|---|
| Predecessor activates itself | `ACTIVATED`; host RUNNING; schema 21 |
| New release's dry run | `UPDATE_REQUIRED`, database 21, release 22 |
| New release's discovery | `RUNNING`, `UPDATE_REQUIRED`, lease live, the same instance the predecessor reports |
| `release-activate` by the new release's CLI | `VERIFY OK → DRY_RUN UPDATE_REQUIRED → PREVIOUS VERIFIED → STOP STOPPED → LEASE RELEASED → BACKUP BY_SAFE_UPGRADE → PIN → START RUNNING → SCHEMA 21->22 → HEALTH READY` = `ACTIVATED` |
| After | One host READY, schema CURRENT 22, the holder is the new instance, the old PID exited, pin `b45142a9…` with previous `e4f2fb2f…`, journal `ACTIVATED` 21→22, snapshot kept, business data identical |
| Predecessor afterwards | `release-check` gives `SCHEMA_FROM_FUTURE`; `open` gives `NOT_ACTIVATED` |
| Same setup with shipped `cb3ef342` (before the fix) | `DRY_RUN_FAILED`; the running host seen as `UNHEALTHY`, `leaseLive: false` (the defect reproduced) |

## 5. Validation (local, Windows; FULL is the GitHub gate on the exact head)

- `npm ci`, then `npm run ci`: classified FULL (storage foundation), 10 of 10 local preflight steps passed:
  - build, typecheck, lint;
  - verify-bootstrap: 533 files, 110 of 110 rules;
  - the four self-tests;
  - test:command-center 80/80, including the new `p1-desktop-upgrade` (6 tests, about 84 s);
  - test:storage 560/560, including the new inspection test.
- **test:runtime 212/212.** Run additionally, because `migrate` was refactored.
- **`npm run desktop:proof`** (disposable): PASS. Its update, failed-update rollback, repair, uninstall, reinstall and
  detached proofs all passed.
  - The first attempt stopped at the detached-checkout rename with `EPERM`: this session's own shell had its working
    directory inside `packages/`. The proof restored both directories itself, and a rerun from the repository root
    passed.
- **Static mutation applicability.** All 607 search targets of the 587 recorded mutations (12 families) still occur
  exactly as expected in the rebuilt tree. No mutation was run locally.
- **Genuine predecessor proof** (§4): `e4f2fb2f` upgraded to 22, and `cb3ef342` reproduces the original refusal.

### 5.1 First FULL run (38072295671, head 0594194): two test defects, no product defect

- **tests (ubuntu-latest), the crashed-holder scenario: a test defect.**
  - It expected `STALE` and read `UPDATE_REQUIRED` after 1.8 s.
  - The test "crashed" the host with `process.kill(pid)`. On Linux that is `SIGTERM`, which the host handles as its
    own controlled stop (`command-center/src/cli.ts`), so it released its lease. That is the stopped case, not a crash.
    On Windows it is `TerminateProcess`, which is why it passed locally.
  - Correction: `SIGKILL`, the hard crash the existing `founder-host-lifecycle` proof already uses. The scenario now
    reads `STALE` with a live lease and waits the lease out (about 34 s locally). The controlled stop stays its own case
    (`STOP:STOPPED`). No product code changed.
- **acceptance (windows-latest), `spike-chat-race`: a harness wait defect.**
  - `bBefore.title` was A's name although the harness had clicked B's card (`bAfter` showed B, correctly).
  - On a first open, `chat.ts` gives the composer to B at once and shows the placeholder "Opening the conversation…";
    the header is redrawn only when the history loads. The harness waited for any `#chat .chat-list li`, which the
    placeholder satisfies (11 ms in the failing trace), so it read the header before B's render.
  - Correction: after Talk, the harness waits until the chat header names the Employee whose profile it opened. No
    sleep, no assertion relaxed.
  - Separate observation, not changed here (UI is out of scope): while a first open loads, the chat header still
    names the previous Employee above the new Employee's composer.
- **CI infrastructure: none.**
- Local after the correction: command-center 80/80; `c5:spike` 3 of 3 with `spike-chat-race` PASS; `npm ci` +
  `npm run ci` (§5). Linux is proven by the FULL gate only (no local Linux).

## 6. Remaining risk

- **The update path is fixed in the new release only.** The update runs the NEW release's code (the bundle's own), so the
  production update needs a new Desktop artifact built from this correction. The `cb3ef342` bundle is superseded and must
  not be re-attempted.
- **The cross-version stop relies on the previous release's own `stop` launcher** (present since D-OPS-02) and on the
  shared lease tables of 0001. A future migration that changes `runtime_leases` / `runtime_instances` would need the
  inspection reviewed. Today none does.
- **`UPDATE_REQUIRED` is now a real, startable discovery state.** It was always intended (STARTABLE). An activated
  release that finds its Company behind (for example after restoring an older backup) runs safe-upgrade at start, as
  designed. It was previously unreachable (`UNHEALTHY`).
- **A failure after a forward migration leaves the Company held by the new pin, not running.** The recovery is the
  existing `rollback-update` with the Founder's approval. That is truthful, but not automatic.
