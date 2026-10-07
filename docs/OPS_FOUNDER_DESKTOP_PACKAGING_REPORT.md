# OPS — Operational / Desktop Packaging — Implementation Report

**Status: IMPLEMENTATION CANDIDATE — NOT CLOSED** (branch `ops/founder-desktop-packaging`, from `main` @
`725508fae3cf615b48a89d3d409871d81f0f0bd4`; decisions D-OPS-01 … D-OPS-08 in `docs/architecture/DECISION_LOG.md`).

**Founder review of `a61e0a5` (first candidate): two Product / Security MAJOR findings, both closed on `b104881`.**

| Finding | Root cause | Correction |
|---|---|---|
| **MAJOR 1** — the Founder launch credential was in the browser's process metadata | The browser was started with `--app=http://127.0.0.1:<port>/launch#<token>` | **D-OPS-07.** The browser is given only `http://127.0.0.1:<random>/`, a one-shot loopback handoff in the launcher. It mints the canonical token only for a user-started browser navigation and hands it over as a redirect to the unchanged `/launch` page. |
| **MAJOR 2** — the production launcher ran the mutable development checkout | The shortcuts ran `<checkout>\packages\command-center\dist\src\cli.js` | **D-OPS-08.** A frozen, content-addressed **release** outside the checkout, plus a workspace **pin**. `CompanyRuntime.start` admits only the activated, intact release. `release-activate` is the one controlled replacement path. |

The `a61e0a5` full gate was cancelled on the Founder's instruction and is not evidence for this head (§7).

## 1. Product outcome

The Founder opens, uses, closes, reopens, stops, restarts and recovers QANDEEL COMPANY from Windows without a terminal.
The canonical Company runtime underneath does not change. It stays persistent, single-instance and secure.

| Founder action | What happens |
|---|---|
| Double-click **QANDEEL COMPANY** (Desktop or Start menu) | The shortcut runs the **activated release's** launcher, never the checkout. The launcher reads the configured production workspace and finds its host. If none runs, it starts exactly one: the existing `qandeel-founder serve` **from the release**, detached, windowless, with the DeepSeek provider behind the vault. Readiness is bounded. It then opens the existing Command Center in an Edge (else Chrome) app window on the one-shot loopback handoff address. The browser's navigation receives a fresh single-use launch token as a redirect to `/launch`. The launcher exits; the host keeps running. |
| Close the Command Center window | Nothing stops. The Company host and its permitted background work continue. |
| Double-click again (or twice at once) | The running host is reused. No second runtime starts, and each launch gets its own fresh session. |
| Start menu → **QANDEEL COMPANY — Stop** | Controlled shutdown of the verified host: settle, park, release the lease, instance STOPPED. A notice confirms it. |
| Start menu → **QANDEEL COMPANY — Restart** | Controlled stop, then open as above. |
| Start menu → **QANDEEL COMPANY — Status** | A notice shows RUNNING / STARTING / STOPPED / STALE / HELD / … |
| Windows sign-out, shutdown or a crash | The next launch performs the runtime's own startup recovery (it waits out the dead holder's lease, then ABANDONs the dead instance) and opens normally. |

There is no sign-in autostart, no elevation, no installer and no desktop framework. The visible UI is the existing
browser Command Center.

**Failure outcomes.** Each failure gives the Founder a bounded, fixed, bilingual notice (Arabic first, then English, with
a support code). There are no raw exceptions, no content and no secrets. The outcomes:
- not configured;
- workspace missing;
- not a Company workspace (nothing is created);
- update hold, restore in progress, or a restore-check copy;
- host unhealthy / not responding;
- an engineering runtime without the Command Center;
- browser unavailable, or the browser never reached the handoff (`BROWSER_HANDOFF_TIMEOUT`; no token was minted);
- **this build is not the activated production release** (`RUNTIME_RELEASE_REFUSED`; nothing is started);
- start or stop timeout;
- provider key missing from the vault (the Company still opens; model work stays held).

## 2. Architecture

The visible UI and the persistent host are separate processes:
- **The launcher.** `node <release>\…\cli.js open`, minimized, short-lived.
- **The Company host.** `node <release>\…\cli.js serve --workspace <LIVE> --background --provider deepseek`, detached (its own
  process group), windowless. Its stdout / stderr go to `<workspace>\runtime\founder-host.log` (content-free JSON
  lines, rotated at 5 MiB). It reports readiness once to the launcher over IPC, then drops the channel.
- **The browser window.** It only views the loopback surface, so closing it ends nothing.

**Discovery (D-OPS-02)** has three sources, and none of them is enough alone:
- the durable supervisor lease and its holder's instance record (the canonical truth, read only);
- the host descriptor, `<workspace>\runtime\founder-host.json`: `{ version, instanceId, pid, port, startedAt, publicKey }`;
- a signed identity probe on the descriptor's port. A random nonce is signed with the instance's in-memory Ed25519 key,
  and verified with the published public key.

A PID is a hint only. A squatter on a freed port, a reused PID, a torn descriptor, a workspace mismatch or a runtime
without the surface are each reported for what they are.

**Single instance (D-OPS-05):**
- the lease stays authoritative;
- a start lock serializes concurrent launchers;
- `serve` refuses to start beside a live host.

**Controlled stop (D-OPS-03):**
1. The launcher leaves a one-shot request in the workspace (instance ID + random request ID).
2. It posts the request ID to `POST /host/stop`.
3. The host consumes the request (no replay) and runs the existing `surface.stop()` → `runtime.stop()`.

`--force` exists only for a host that does not answer. It terminates only the verified lease holder's PID, and
recovery handles the rest. It is never the normal path.

**Launch handoff (D-OPS-07):**
1. The launcher binds a one-shot responder on `127.0.0.1:<random>`.
2. It starts the browser with `--app=http://127.0.0.1:<random>/`. That is the only browser argument.
3. The responder accepts exactly one request: `GET /`, the exact Host, and `Sec-Fetch-Site: none`,
   `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`. Only then does it mint the canonical token.
4. It answers `303 Location: <host>/launch#<token>` and closes.
5. The existing `/launch` page redeems the token once and clears it from history.

Other requests get 403 and consume nothing. No browser within 30 s → `BROWSER_HANDOFF_TIMEOUT`, and no token is minted.

**Production release (D-OPS-08).** The Stage 12 path, reusing the existing mechanisms:

```
checkout:  npm ci → npm run ci (Build → Test) → release-stage
           → %LOCALAPPDATA%\QANDEEL_COMPANY\releases\<id>\   (frozen copy + qandeel-release.json: SHA-256 of every file)
release-activate --workspace <LIVE> --release <id>:
   VERIFY (every file vs. manifest) → DRY_RUN (the release's own CLI: loads, re-verifies itself, reads the schema)
   → STOP (controlled, D-OPS-03) → BACKUP (createBackup + verifyBackup) → PIN (<workspace>\runtime\production-release.json)
   → START from the release (CompanyRuntime.start → admission → schema safe-upgrade if pending) → HEALTH (signed identity + READY)
   → SHORTCUTS (pointed at the release CLI)
   failure before PIN: nothing changed · failure after PIN: previous pin restored, previous release restarted
```

**Admission** is in the runtime: `admitRuntimeRelease`, called first in every `CompanyRuntime.start`. A pinned
workspace refuses:
- a non-release build (`NOT_A_RELEASE`: any development checkout, whatever its branch, `npm ci` or build);
- another release (`NOT_ACTIVATED`);
- any edited or added file (`RELEASE_TAMPERED`);
- an unreadable pin (`PIN_INVALID`).

It refuses before the Company is opened or migrated. The launcher pre-checks admission for a bounded Founder notice. An
unpinned (development or test) workspace admits any build, as before.

## 3. Reuse / anti-duplication

Reused unchanged:
- `FounderSurface` and `CompanyRuntime`: supervisor lease, startup recovery, graceful shutdown, safe-upgrade at start,
  update / restore holds;
- the loopback listener and its origin / session / CSRF gate;
- `FounderAuthStore.mintLaunchToken` (the same mint as `qandeel-founder launch`), the `/launch` page and the single-use
  token exchange;
- the DPAPI `WindowsUserVault` and the DeepSeek adapter wiring of `serve --provider deepseek`;
- the workspace layout (`runtime/`), the content-free logger and the `restoreStatus` / hold readers.

**New code:**
- `@qandeel-company/command-center`:
  - `src/host/descriptor.ts`: descriptor, identity, one-shot stop request;
  - `src/host/probe.ts`: the loopback-only client of the two host routes;
  - `src/host/processes.ts`: the one process module;
  - `src/host/lifecycle.ts`: discovery, open, stop, restart, configuration, shortcuts, notices;
  - `src/host/handoff.ts`: the one-shot launch handoff (D-OPS-07);
  - `src/host/release.ts`: stage / activate / status (D-OPS-08).
- `@qandeel-company/runtime`: `src/release.ts`, the admission (D-OPS-08), called by `CompanyRuntime.start`.
- `@qandeel-company/domain`: one error code, `RUNTIME_RELEASE_REFUSED`.

The release reuses the existing backup (`createBackup` / `verifyBackup`), the schema safe-upgrade and `UPDATE_HOLD`, the
controlled stop, discovery and health. No new updater, installer or service exists.

**Modified:**
- the listener: two host-control routes, present only in the host role;
- the surface: publishes / unpublishes the descriptor, accepts a verified stop;
- the CLI: `open`, `status`, `stop`, `restart`, `install-shortcuts`, `serve --background`, and `release-stage`,
  `release-activate`, `release-status`, `release-check`. Every `serve` refuses to start beside a live host and exits on a
  runtime fail-stop. `launch` now names the port. `install-shortcuts` writes shortcuts only for an activated release.
- `CompanyRuntime.start`: one admission call before the first open.

There is no second runtime, backend, UI, database, authentication system or package.

## 4. Security

- **Loopback only.** The host listens on 127.0.0.1 only (live proof: the Windows listen table shows 127.0.0.1 only, and
  the LAN address 192.168.100.13 on the same port is not reachable). The probe client connects to 127.0.0.1 only.
- **Authentication preserved.** Founder reads still need a verified session (live: unauthenticated `/api/universe` →
  401). A session still begins only with the canonical single-use, 90-second launch token (proved: a second redemption
  → 401). The host routes read and create no session and set no cookie.
- **CSRF preserved.** Every Founder state change still needs the exact Origin and the CSRF double submit (live: an
  unauthenticated POST → 403; test: a POST with a session but without the CSRF header → 403). The host stop passes the
  same origin gate and is CSRF-exempt only because it carries its own one-shot workspace proof, like the launch
  exchange.
- **Vault boundary preserved.** The provider key stays in DPAPI CurrentUser. The launcher only checks that the vault
  reference exists (a file-presence check: no decrypt, no read).
- **No secret leaves the vault.** No secret appears in:
  - the host's command line (`serve --workspace <path> --background --provider deepseek`);
  - the shortcut (target `C:\Program Files\nodejs\node.exe`, Authenticode Valid; arguments `"<release>\…\cli.js" open --notify`);
  - **the browser's command line** (only `--app=http://127.0.0.1:<port>/`; D-OPS-07, live-proved §6);
  - the launcher configuration (`{ version, workspace, providers }`);
  - the descriptor (a public key only);
  - the host log (live: 0 matches for `launch#`, `Bearer`, `sk-…`, `PRIVATE KEY`);
  - any process command line (live: 0).
- **The launch credential stays out of process metadata (D-OPS-07).** The token never exists in any argument, file,
  environment variable, shortcut, configuration or log. It is minted only when the browser's own navigation reaches the
  one-shot handoff, travels over that loopback connection, and is redeemed by the unchanged `/launch` exchange.
  - Defences: fetch-metadata (no web page can send `Sec-Fetch-Site: none`), the exact Host (no DNS rebinding), one
    shot, a 30 s life.
  - The browser sends its loopback cookies to every 127.0.0.1 port, so the responder logs and serializes nothing.
  - Residual: a local process that wins a sub-second race on the random port with forged headers. It gains no more than
    the same-user `launch` command, and unlike an argument, nothing is left behind.
- **The production runtime is a validated release, not the checkout (D-OPS-08).** A pinned Company runs only the
  activated release, verified file by file at every start. Admission happens before any open, so an unadmitted build
  cannot migrate LIVE either.
- **No authority or budget increase.** No new generic execution endpoint exists. The two host routes are fixed:
  identity and stop. No governance, budget, provider, employee or Academy code changed.
- **Smart App Control untouched.** Only the signed Node runtime, the installed Edge / Chrome, and the signed System32
  Windows PowerShell host run, with `shell: false`. There are no native binaries and no new dependency.
- **Verifier and eslint.** Rules `founder-host-confined` (now covering the handoff: random loopback bind, exact Host,
  the three fetch-metadata checks, no request logging, one-shot close, `openBrowser(handoff.url)` only),
  `ops-release-admission` (admission before open / upgrade, the refusals, shortcuts only for a release CLI, the
  activation steps) and `ops-proofs-present` (four proof markers) enforce the confinement. Every rule is self-tested
  with violation and must-pass scenarios. The probe, the handoff and the process module are the only reviewed
  exceptions to `no-network-in-runtime-code` / `founder-listener-loopback-only`.

## 5. Validation

**Focused, during implementation:**
- `packages/command-center/test/founder-host.test.ts` (11 tests): descriptor / signature / impostor key / torn
  descriptor; the one-shot stop and replay; host routes behind the origin gate (bad nonce, rebinding Host, cross-site,
  no / foreign Origin, wrong content type, a guessed request ID, replay, 405); no route without the host role;
  discovery states (missing / invalid with nothing created, STOPPED / RUNNING / stop / STALE, a squatter →
  `HOST_IDENTITY_MISMATCH`, FOREIGN_RUNTIME, update and restore holds refused before any spawn); and the notices.
- `packages/command-center/test/founder-host-lifecycle.test.ts` (5 tests, real detached processes): cold start + one
  session from the canonical token, used once, and CSRF; reuse and three concurrent launches → one host; host alive
  without a launcher, LAN unreachable, no token / key in the descriptor or log; controlled stop (instance STOPPED, PID
  gone) and restart on the same Founder; hard kill → STALE → the runtime's recovery ABANDONs the dead instance.
- The whole `@qandeel-company/command-center` suite on `a61e0a5`: 7 files, 30 tests, all passing.

**Focused, for the MAJOR corrections (on `b104881`):**
- `founder-host-lifecycle.test.ts` (now 7 tests, marker `founder-launch-handoff`):
  - A recording browser receives exactly the argument vector the real opener builds. Its command line is
    `--app=http://127.0.0.1:<port>/`, with no token, `#`, `?` or `/launch`, and no token exists yet when it starts.
  - Six refused requests, each 403 and none minting: no fetch metadata, a cross-site navigation, a page fetch, a
    DNS-rebound Host, a POST and `/launch`.
  - The real navigation gets a 303 to `<host>/launch#<token>`. Exactly one token is minted; it opens one session, once.
  - The handoff is gone afterwards.
  - A browser that never arrives → `BROWSER_HANDOFF_TIMEOUT` and nothing minted. No browser → `BROWSER_UNAVAILABLE` and
    nothing minted.
- `founder-host-release.test.ts` (new, 6 tests, marker `founder-host-release`, real processes):
  - Staging is outside the checkout, content-addressed and idempotent, and is refused inside the checkout.
  - Admission: unpinned → any build; pinned → only the activated release. A dev build → `NOT_A_RELEASE`; another
    release → `NOT_ACTIVATED`; an edited file and an added file → `RELEASE_TAMPERED`; a torn pin → `PIN_INVALID`.
  - `CompanyRuntime.start` from the dev build on a pinned Company → refused, no lease, no instance.
  - Activation runs VERIFY → DRY_RUN → STOP → BACKUP (VERIFIED) → PIN → START → HEALTH. The host log shows
    `runtime.release_admitted` PINNED with the release ID. Every shortcut targets the release CLI, never the checkout.
  - **Drift:**
    - the dev `open` → `RUNTIME_RELEASE_REFUSED` / `NOT_A_RELEASE`, no token;
    - dev `status` reports `NOT_A_RELEASE`;
    - dev `install-shortcuts` refused;
    - a host spawned from the checkout, bypassing the launcher, is refused by its own runtime;
    - an edited release file → `RELEASE_TAMPERED`, and after restoring it the release starts again.
  - **Replacement:**
    - release B is activated with `previousReleaseId` A, and A is then refused `NOT_ACTIVATED`;
    - a build that cannot load → `DRY_RUN_FAILED`, with the pin unchanged and the running host never stopped;
    - a build whose host never comes up → `ROLLED_BACK`, with pin B restored and B running again.
- `founder-host.test.ts`: the notices for the new outcomes.
- The `@qandeel-company/command-center` suite: **38 / 38**.
- The `@qandeel-company/runtime` suite (`CompanyRuntime.start` changed): **183 / 183**.
- Typecheck (all workspaces) and lint (`--max-warnings=0`): clean.
- The verifier: the self-test of every rule passed, then **108 / 108**.

**Failures met during implementation, classified** (first candidate):
- **A (product).** The launcher passed `--host` while the CLI flag is `--background`, so the first spawned host
  refused its arguments. Found by the first manual smoke and fixed before any test was written.
- **B (validation).**
  - The verifier's new probe-host regex backtracked (`\s*` before a negative lookahead) and rejected the real module
    in self-test. Rewritten as `host:(?!\s*LOOPBACK_HOST\b)`.
  - The crash proof used SIGTERM, which Linux handles gracefully; it now uses SIGKILL, so the proof is a hard crash on
    every platform.
  - Two `no-useless-assignment` lint findings.
- **C (infrastructure).** Python is absent on the host, and bash heredocs with apostrophes fail in this shell; patches
  were applied with Node scripts instead. No product effect.

**Failures met during the MAJOR corrections, classified:**
- **A (product).** The two MAJOR findings themselves; there was no other product failure. The new focused tests passed
  on their first run.
- **B (validation).**
  - The new verifier rule tripped on the clean synthetic repository, whose stub `runtime.ts` has no release module. It
    is now scoped to repositories that contain the admission module.
  - Two test details were fixed before the first run: a cross-drive "outside the checkout" check, and the runtime test
    constructor's required `processors`.
- **C (infrastructure).**
  - The cancelled `a61e0a5` gate left mutation-check child processes; they were terminated, the tree was verified clean,
    and the build was redone from scratch.
  - Bash heredocs with apostrophes again; patches were applied through Node scripts.
  - A header-measurement probe printed the Founder's loopback session cookies once, to this session only. All LIVE
    sessions had already been revoked by the earlier controlled stop (0 live of 28), so nothing usable was exposed.

**Focused, for the Windows crash-recovery correction (D-OPS-09):**
- **The defect.** On the GitHub Windows runner (#111, #113), the hard-kill proof read `UNHEALTHY` instead of `STALE`. Classified
  **A (product, OPS)**.
- `founder-host.test.ts` (now 13 tests), two new proofs:
  - a scripted classifier: healthy and squatter readings are read once; store-read errors and `HOST_NOT_ANSWERING` settle
    to STALE; a stuck UNHEALTHY is reported within the bound;
  - a real live holder whose surface does not answer (a closed port, and a port that accepts but never answers) stays
    `UNHEALTHY` / `HOST_NOT_ANSWERING`, `ensureRunning` refuses `HOST_UNHEALTHY`, and no host is spawned.
- `founder-host-lifecycle.test.ts`: the hard-kill proof now logs the raw single reading and the settled one (state,
  reason, leaseLive, runtimeState, descriptor, PID, PID-alive). On the Founder host both read `STALE` /
  `HOST_PROCESS_GONE`.
- The `@qandeel-company/command-center` suite: **40 / 40**.

**Final closure gate:** see §7.

## 6. Windows real proof (Founder host, 2026-10-07, LIVE workspace `E:\QANDEEL_COMPANY_DATA\LIVE`)

**Setup.** `install-shortcuts --workspace <LIVE> --provider deepseek` wrote:
- the per-user configuration;
- the Desktop shortcut **QANDEEL COMPANY**;
- the Start-menu folder **QANDEEL COMPANY**: Open, Status, Stop, Restart.

Every launch below went through the real `.lnk` via the Windows shell (ShellExecute, which is what a double-click does).
Read-back is content-free throughout: IDs, counts, states.

**Scenario 1 — Cold start, plus natural crash recovery.**
- **Before.** LIVE was stopped, and its last instance `a2332b09` had died without a clean stop (lease expired).
- **The click.** One host started (`serve … --background --provider deepseek`, supervisor token 26). The runtime's own
  recovery marked `a2332b09` ABANDONED.
- **The session.** Launch token #29 was minted and redeemed by the browser within a second (session #24, bound to
  that launch ID). The Edge window titled "QANDEEL — Company" opened.
- **State.** The launcher exited, and the vault key was present. This was the existing production Company: schema 21,
  279 done / 19 failed jobs (unchanged), not a new seed.

**Scenario 3 — Close the UI.** The Command Center window was closed (WM_CLOSE). The host PID stayed alive.

**Scenarios 2 / 5 — Reopen and concurrency.** Two launches were fired at once through the shortcut. Still one host
(same PID 19672, same instance `c64ad85d`), with two fresh tokens and two sessions (#25, #26). No launcher remained.

**Scenario 7 — Stop and restart.**
- **Stop.** The Start-menu Stop shortcut produced, in the host log, `founder.host_stop_accepted` → `runtime.stopping` →
  `runtime.stopped`. The host PID exited; the instance `c64ad85d` is durably STOPPED; the lease was released; the
  descriptor was removed.
- **Restart.** The Restart shortcut started one new host (`ae2cf958`) and a new session (#27).

**Scenario 4 — Controlled abnormal termination.**
- **The kill.** `Stop-Process -Force` on host `ae2cf958`. Status was immediately STALE / `HOST_PROCESS_GONE`, never
  "running".
- **Recovery.** The Desktop shortcut brought the Company back to RUNNING in 28 s (the lease wait plus startup recovery),
  as instance `1f9faca3`. `ae2cf958` is ABANDONED.
- **Outcome.** Job counts are unchanged (no duplicate work). Health is HEALTHY, with the pre-existing reasons
  BUDGET_NEAR_LIMIT and DIRECTOR_SEATS_VACANT only.

**Scenario 6 — Security** (see §4): loopback-only listen; LAN unreachable; 401 / 403 without a session; descriptor keys
only `version, instanceId, pid, port, startedAt, publicKey`; 0 secret matches in the log and in process arguments.

Scenarios 1–7 above ran on the first candidate (`a61e0a5`, launcher in the checkout). The corrected head was proved on
the same LIVE workspace, 2026-10-07:

**MAJOR 2 — Activation on LIVE.**
- `release-stage` froze build `b104881` as release `1bbf3625b2e10875…`: 214 files, under
  `%LOCALAPPDATA%\QANDEEL_COMPANY\releases\`.
- `release-activate --workspace <LIVE> --release 1bbf3625b2e10875 --provider deepseek` returned **ACTIVATED**. The steps:
  VERIFY OK → DRY_RUN CURRENT → STOP NOT_RUNNING → BACKUP VERIFIED (backup `29e82df7`, canonical in `backup_records`) →
  PIN OK → START RUNNING → HEALTH READY → SHORTCUTS OK.
- **The host process** is `node.exe <release>\node_modules\@qandeel-company\command-center\dist\src\cli.js serve
  --workspace E:\QANDEEL_COMPANY_DATA\LIVE --background --provider deepseek`. The host log shows `runtime.release_admitted`
  mode PINNED with the release ID.
- **All five shortcuts** (Desktop, Start-menu Open / Status / Stop / Restart) target the signed `node.exe` with the
  release CLI. None references the checkout.
- **Drift refused on LIVE.**
  - The checkout's own `open --workspace <LIVE>` → `RUNTIME_RELEASE_REFUSED` / `NOT_A_RELEASE`, exit 1, no token minted
    (count unchanged at 34).
  - `release-status` from the checkout: `admitted: NOT_A_RELEASE`; from the release: `ADMITTED`, pin VALID, intact.
- **Restart shortcut.** A controlled stop, then a new host `99af4baf` from the release: PINNED admission, and a new
  session redeemed from its token.

**MAJOR 1 — The real Edge process on LIVE.** The Desktop shortcut was launched while a watcher read every new
`msedge.exe`, `chrome.exe` and `node.exe` command line every 40 ms (content-free counts):
- 29 processes observed, **0 credential matches**;
- the one browser `--app` argument had the shape `http://127.0.0.1:58653/`: the handoff root, no token, no fragment;
- launch tokens minted went from 33 to 34, exactly one. The newest session is bound to that launch ID and is live;
- the window "QANDEEL — Company" opened.

A full scan of all 149 process command lines on the host also found 0 credential matches.

## 7. Final closure gate

- **`a61e0a5`:** the gate was started, then cancelled on the Founder's instruction after review found the two MAJOR
  defects. It is not closure evidence.
- **`574ac11`** (Founder rule: `LOCAL = IMPACTED BOUNDARY`; the full historical mutation universe is a parallel GitHub
  proof, not a per-task local requirement):
  - **local:** `npm ci`, build, typecheck, lint, every workspace test and the harness, and C1 / C2 / C3 mutation all
    passed; the serial gate was then stopped on the Founder's instruction; `npm run verify` passed 108 / 108;
  - **GitHub #113:** `acceptance` failed on both OSes on the pre-existing C5 defect below; `tests (windows-latest)` failed
    on the OPS crash-recovery proof (D-OPS-09); everything else that ran was green.
- **The D-OPS-09 head:** locally, the command-center suite (40 / 40), typecheck, lint and `npm run verify`. The
  cross-environment proof is the GitHub `tests (windows-latest)` job on the same SHA; its result is reported with the
  SHA, not assumed here.
- **Known, pre-existing, outside OPS scope:** the C5 acceptance smoke `spike-english-ui-content-as-written` fails with
  "application chrome carries Arabic". Classified **A — pre-existing product regression**, not caused by this branch.
  Deferred to a bounded follow-up before P1, not fixed here.

## 8. Residuals (real, Product-level)

- **R-OPS-01 — CLOSED by D-OPS-08** (it was MAJOR 2). The shortcuts run the activated release outside the checkout, and
  the runtime refuses any other build for the pinned workspace.
- **R-OPS-01a — Releases are kept, not pruned.** Each is a few MB under `%LOCALAPPDATA%\QANDEEL_COMPANY\releases\`.
  Pruning old releases is a later operational step.
- **R-OPS-01b — Activation does not itself run the test suite.** Build → Test is the operator's `npm run ci` before
  `release-stage`. The release records its source commit, and activation runs the dry run, backup, safe-upgrade and health
  check. A schema that a new release migrated is not rolled back by re-pinning the old release (forward-only); the old
  release is then refused by the schema check, and the existing `rollback-update` restores the pre-update snapshot.
- **R-OPS-01c — The same-user trust boundary.** A process running as the Founder's Windows user could rewrite a release
  and its manifest, or the pin, together. That is the same boundary as the vault and the launch files. The guarantee is
  that ordinary development activity (edits, branches, `npm ci`, builds) never silently becomes production.
- **R-OPS-02 — The shortcut shows the Node icon.** No brand icon exists in the repository yet.
- **R-OPS-03 — A brief minimized console.** The launcher is a console program, so a minimized taskbar entry appears for
  about a second while it runs. Hiding it fully would need a script host (VBS / WSH), which this task avoided under Smart
  App Control.
- **R-OPS-06 — The handoff race.** See §4: a sub-second local race with forged headers; no argument is left behind.
- **R-OPS-04 — Recovery after a crash takes up to about 35 s.** That is the supervisor lease TTL; it is canonical
  runtime behaviour, unchanged. The launcher waits for it (bounded).
- **R-OPS-05 — Sign-in autostart is not installed.** That remains a later Product decision.
