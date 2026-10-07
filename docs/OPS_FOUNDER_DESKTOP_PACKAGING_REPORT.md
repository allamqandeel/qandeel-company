# OPS — Operational / Desktop Packaging — Implementation Report

**Status: IMPLEMENTATION CANDIDATE — NOT CLOSED** (branch `ops/founder-desktop-packaging`, from `main` @
`725508fae3cf615b48a89d3d409871d81f0f0bd4`; decisions D-OPS-01 … D-OPS-06 in `docs/architecture/DECISION_LOG.md`).

## 1. Product outcome

The Founder opens, uses, closes, reopens, stops, restarts and recovers QANDEEL COMPANY from Windows without a terminal.
The canonical Company runtime underneath does not change. It stays persistent, single-instance and secure.

| Founder action | What happens |
|---|---|
| Double-click **QANDEEL COMPANY** (Desktop or Start menu) | The launcher reads the configured production workspace and finds its host. If none runs, it starts exactly one: the existing `qandeel-founder serve`, detached, windowless, with the DeepSeek provider behind the vault. Readiness is bounded. The launcher then mints a fresh single-use launch token and opens the existing Command Center in an Edge (else Chrome) app window, and exits. The host keeps running. |
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
- browser unavailable;
- start or stop timeout;
- provider key missing from the vault (the Company still opens; model work stays held).

## 2. Architecture

The visible UI and the persistent host are separate processes:
- **The launcher.** `node …\cli.js open`, minimized, short-lived.
- **The Company host.** `node …\cli.js serve --workspace <LIVE> --background --provider deepseek`, detached (its own
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

## 3. Reuse / anti-duplication

Reused unchanged:
- `FounderSurface` and `CompanyRuntime`: supervisor lease, startup recovery, graceful shutdown, safe-upgrade at start,
  update / restore holds;
- the loopback listener and its origin / session / CSRF gate;
- `FounderAuthStore.mintLaunchToken` (the same mint as `qandeel-founder launch`), the `/launch` page and the single-use
  token exchange;
- the DPAPI `WindowsUserVault` and the DeepSeek adapter wiring of `serve --provider deepseek`;
- the workspace layout (`runtime/`), the content-free logger and the `restoreStatus` / hold readers.

**New code**, all inside `@qandeel-company/command-center`:
- `src/host/descriptor.ts`: descriptor, identity, one-shot stop request;
- `src/host/probe.ts`: the loopback-only client of the two host routes;
- `src/host/processes.ts`: the one process module;
- `src/host/lifecycle.ts`: discovery, open, stop, restart, configuration, shortcuts, notices.

**Modified:**
- the listener: two host-control routes, present only in the host role;
- the surface: publishes / unpublishes the descriptor, accepts a verified stop;
- the CLI: `open`, `status`, `stop`, `restart`, `install-shortcuts`, and `serve --background`. Every `serve` refuses to
  start beside a live host and exits on a runtime fail-stop. `launch` now names the port.

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
  - the shortcut (target `C:\Program Files\nodejs\node.exe`, Authenticode Valid; arguments `"<cli.js>" open --notify`);
  - the launcher configuration (`{ version, workspace, providers }`);
  - the descriptor (a public key only);
  - the host log (live: 0 matches for `launch#`, `Bearer`, `sk-…`, `PRIVATE KEY`);
  - any process command line (live: 0).
- **The browser argument.** It carries the canonical single-use launch token, which is redeemed within a second. The
  same-user boundary already lets any local process mint one with `launch`.
- **No authority or budget increase.** No new generic execution endpoint exists. The two host routes are fixed:
  identity and stop. No governance, budget, provider, employee or Academy code changed.
- **Smart App Control untouched.** Only the signed Node runtime, the installed Edge / Chrome, and the signed System32
  Windows PowerShell host run, with `shell: false`. There are no native binaries and no new dependency.
- **Verifier and eslint.** New rules `founder-host-confined` and `ops-proofs-present` enforce the confinement, and the
  two host modules are the only reviewed exceptions to `no-network-in-runtime-code` / `founder-listener-loopback-only`.

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
- The whole `@qandeel-company/command-center` suite: 7 files, 30 tests, all passing (existing C5 / C7-D / L1-02 surface
  and security tests unchanged and green).
- Typecheck (all workspaces), lint (`--max-warnings=0`) and the verifier: self-test of 106 rules, then 107 / 107 rules
  passing.

**Failures met during implementation, classified:**
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

**Final closure gate:** see §7. It is one full `npm ci` + `npm run ci` on the exact closure-candidate head.

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

## 7. Final closure gate

To be recorded after the single full gate on the exact closure-candidate head.

## 8. Residuals (real, Product-level)

- **R-OPS-01 — The installation location is the repository checkout.** The shortcuts run
  `E:\QANDEEL_COMPANY\packages\command-center\dist\src\cli.js` (resolved at install time, never hard-coded). Checking out
  another branch, or a `npm run build` while the Founder launches, changes what the shortcut runs. A separate installed
  copy is installer work the contract excludes. Re-run `install-shortcuts` after moving the checkout.
- **R-OPS-02 — The shortcut shows the Node icon.** No brand icon exists in the repository yet.
- **R-OPS-03 — A brief minimized console.** The launcher is a console program, so a minimized taskbar entry appears for
  about a second while it runs. Hiding it fully would need a script host (VBS / WSH), which this task avoided under Smart
  App Control.
- **R-OPS-04 — Recovery after a crash takes up to about 35 s.** That is the supervisor lease TTL; it is canonical
  runtime behaviour, unchanged. The launcher waits for it (bounded).
- **R-OPS-05 — Sign-in autostart is not installed.** That remains a later Product decision.
