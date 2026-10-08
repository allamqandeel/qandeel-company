# QANDEEL COMPANY — Windows Desktop distribution (D1)

The one canonical place for the Windows Desktop product. Decisions are in `docs/architecture/DECISION_LOG.md` as
D-D1-01 … D-D1-08.

The installed product is an orchestration shell over the existing OPS mechanisms. It adds no second runtime, release
format, updater database, backup system, host identity or Founder authentication.

## The supported Founder-local install (D-D1-08)

Desktop v1 is Founder-local. The supported artifact is the **Desktop bundle**, a folder; commercial code signing is
deferred until external distribution. The folder holds:
- the pinned official Node.js 24.19.0 win-x64 `node.exe`, Authenticode-signed by the OpenJS Foundation;
- the canonical QANDEEL release;
- the approved icon;
- `qandeel-desktop-bundle.json`.

Installing runs only signed binaries, with no custom executable. Run the bundle's own `node.exe` once:

```text
"<bundle>\node\node.exe" "<bundle>\release\node_modules\@qandeel-company\command-center\dist\src\cli.js" desktop-local-install --bundle "<bundle>"
```

If no Company is configured yet, add `--workspace "<existing Company workspace>"`. Setup never creates a Company.

`desktop-local-install` runs these steps:
1. verifies the bundle byte for byte, and that it runs on the bundle's own runtime and code;
2. finds the EXISTING Company read-only, before installing anything;
3. copies the bundle, verified, into `%LOCALAPPDATA%\Programs\QANDEEL COMPANY\versions\<version>-<bundle id>\`;
4. hands over to the INSTALLED copy for the canonical activation: verify → dry run → controlled stop → verified backup
   → pin → start → health, with rollback on failure;
5. writes the branded Desktop and Start-menu shortcuts (no console window);
6. registers **QANDEEL COMPANY** in Windows "Apps".

After that, the Founder uses QANDEEL COMPANY like any desktop application. It needs no terminal, Git, npm, global
Node or development checkout.

| Run | What happens |
|---|---|
| **First install** | Adopts the existing Company: the launcher configuration, or `--workspace`. With no Company it ends `SETUP_REQUIRED` (exit 2) and installs and creates nothing. |
| **Update (newer bundle)** | Installed beside the running version, then the same activation. Reported only when the new host is READY. On failure the canonical rollback restores the previous release; shortcuts, the "Apps" entry and the Company are unchanged (exit 1). |
| **Repair (same bundle again)** | A damaged copy is replaced after a controlled stop; the identical release is reused; the shortcuts are re-established. |
| **Uninstall (Windows "Apps")** | The entry's command uses signed Windows binaries only (`conhost --headless` → Windows PowerShell). It runs the installed runtime's application-only uninstall: controlled stop, shortcuts removed. Then it removes `…\Programs\QANDEEL COMPANY` and the entry. If the host cannot be stopped, nothing is removed. |

Company data stays where OPS put it. Neither the install nor the uninstall ever moves, creates or deletes:
- the workspace (e.g. `E:\QANDEEL_COMPANY_DATA\LIVE`);
- `%LOCALAPPDATA%\QANDEEL_COMPANY\launcher\` (the launcher configuration);
- `…\releases\`;
- `…\vault\`;
- the production pin;
- the backups.

Desktop v1 has no internet updater, no autostart, no PATH change and no "delete my Company" option.

### Controlling the Company from its window (D-D2-01)

In the Command Center, **Company running** opens Status, **Stop Company** and **Restart Company**, each confirmed first.
- **Stop** keeps the same window open on a STOPPED screen with **Start Company**. The screen is served by the short-lived,
  loopback-only stopped-state controller, which uses only the canonical launcher operations.
- **Start** returns the window to the Command Center once the Company is READY, through the canonical single-use launch
  token.
- Closing the window (X) never stops the Company.
- The Start-menu **Status / Stop / Restart** shortcuts remain the emergency controls. A Stop from there leaves an open
  window on a truthful "not running" screen.

`npm run desktop:control-proof -- [--out <evidence dir>]` proves this in a real Microsoft Edge app window, with an
isolated profile on a disposable Company. It is local only: it shows a window and is not a CI step.

## Build

```bash
npm ci
npm run desktop:bundle -- --out <a directory outside this repository>
```

The build:

1. checks the source;
2. runs `npm run build`;
3. stages the canonical release (`stageRelease`);
4. obtains the pinned Node runtime and verifies it: SHA-256 plus an x64 PE image;
5. composes and self-verifies the bundle;
6. runs the leak scan (no checkout path, no secret);
7. writes `QANDEEL-COMPANY-Desktop.verification.json`.

The record is `FOUNDER-RC` when the bundle verifies, has no leak, its `node.exe` signature is Valid (OpenJS
Foundation) and the source is a clean exact commit.

Pins live in `desktop.pins.json`. Nothing generated is committed.

### Optional: `QANDEEL-COMPANY-Setup.exe` (ENGINEERING)

`npm run desktop:setup` also compiles an Inno Setup 6.7.3 installer over the same bundle (per-user, side by side, the
same `desktop-install` / `desktop-uninstall`). It is proven end to end on CI. It stays an ENGINEERING artifact until
external distribution, because an unsigned custom executable can be refused by Smart App Control.

Its signing seam (D-D1-06) takes `QANDEEL_SIGN_THUMBPRINT` and `QANDEEL_SIGNTOOL` from the environment only. Its
artifact class is `FOUNDER-RC` only when it is signed with a valid signature.

`npm run desktop:verify -- --dist <dir>` re-checks the Founder-local bundle and the Setup artifact from their own
files.

## Proofs (D-D1-07, D-D1-08)

- `npm run desktop:proof -- --workspace <disposable dir>`
  - **Where:** any machine, including the Founder's, because it is fully disposable. It uses an isolated
    LOCALAPPDATA, shortcut root and Company, plus a scratch per-user "Apps" key that it removes afterwards. It never
    touches the real profile or LIVE.
  - **How:** it installs with `desktop-local-install` from a "downloaded" bundle folder. It runs the INSTALLED CLI on
    the INSTALLED private runtime with no Node / npm / Git on PATH. It launches the shortcut and uninstall commands
    the way Windows does and judges them by their effects.
  - **What it proves:** packaging, install, runtime, update, rollback, repair, uninstall from "Apps", reinstall, and
    running with the checkout's `packages/` and `node_modules/` unavailable.
- `npm run desktop:e2e -- --workspace <dir> [--artifacts <dir>]`
  - **Where:** a disposable Windows CI runner only. It refuses elsewhere, and wherever any QANDEEL data exists.
  - **What it proves:** the optional Setup.exe end to end, plus the Founder-local install with the runner's real
    "Apps" entry and its uninstall.
  - **Output:** the Founder-local bundle with its verification record, and the ENGINEERING Setup.exe.
- `.github/workflows/desktop.yml` runs both, plus `desktop:verify`, on the GitHub Windows runner. It runs as the FULL
  gate's `desktop` job and on any non-main branch push that changes this directory.

The real Founder installation is D2 — Founder Laptop Acceptance.

## Icon (D-D1-03)

`assets/qandeel-company.ico` is derived from the ratified QANDEEL brand authority I-08B2.5 app icon:
- the source is `assets/source/APP_ICON_B_DARK_LUMINOUS.svg`, a one-time byte-exact copy, SHA-256 `859665d8…`;
- it was rasterised once by `assets/render-icon.mjs` (Chromium, exact sizes, no redraw);
- the renders are pixel-identical to the brand package's own renders at every shared size;
- provenance is in `assets/ICON_PROVENANCE.json`.

Nothing depends on the QANDEEL App repository at build or run time.
