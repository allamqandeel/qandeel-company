# QANDEEL COMPANY — Windows Desktop distribution (D1)

The one canonical place for the Windows Desktop product: **`QANDEEL-COMPANY-Setup.exe`**. Decisions are in
`docs/architecture/DECISION_LOG.md` as D-D1-01 … D-D1-07.

The installed product is an orchestration shell over the existing OPS mechanisms. It adds no second runtime, release
format, updater database, backup system, host identity or Founder authentication.

## What Setup installs

```text
%LOCALAPPDATA%\Programs\QANDEEL COMPANY\                  per-user, no elevation (Inno Setup, PrivilegesRequired=lowest)
  versions\<desktop version>-<bundle id 12>\               one directory per Setup: side by side, never overwritten in use
    node\node.exe, node\LICENSE                            the private Node 24.19.0 win-x64 runtime (pinned SHA-256)
    release\…                                              one canonical content-addressed release (qandeel-release.json)
    app\qandeel-company.ico                                the approved product icon
    qandeel-desktop-bundle.json                            qandeel.desktop-bundle/v1: source → release → runtime → icon
  unins000.exe / .dat                                      Inno Setup's own uninstaller (HKCU "Apps" entry)
```

Company data stays where OPS put it, and Setup never moves, creates or deletes it:
- the workspace (e.g. `E:\QANDEEL_COMPANY_DATA\LIVE`);
- `%LOCALAPPDATA%\QANDEEL_COMPANY\launcher\` (the launcher configuration plus the product record
  `desktop-product.json`);
- `…\releases\`;
- `…\vault\`;
- the production pin;
- the backups.

## How Setup behaves

| Run | What happens |
|---|---|
| **First install** | Setup verifies the bundle and adopts the EXISTING Company: the launcher configuration, or the Founder's choice on the first-run page. It imports the release, runs the canonical activation (verify → dry run → controlled stop → verified backup → pin → start → health) and writes the shortcuts (`conhost --headless` → private runtime, product icon). With no Company chosen it finishes with "setup required" (exit 102) and creates nothing. |
| **Newer Setup (update)** | Installs a new versioned directory beside the running one, then runs the same activation. Reported successful only when the new host is READY. On failure the canonical rollback restores the previous release; shortcuts and Company are unchanged (exit 101). |
| **Same Setup again (repair)** | Controlled stop through that version's own CLI, then restores every installer-owned file. It then reuses the identical release and re-establishes the shortcuts. |
| **Uninstall (Windows Apps)** | Controlled stop and removes the shortcuts. Setup then removes its program files and its HKCU entry. If the host cannot be stopped, nothing is removed. Company data, vault, releases, pin and configuration stay; a reinstall returns to the same Company. |

Desktop v1 has no internet updater, no autostart, no PATH change and no "delete my Company" option.

## Build (Windows build machine or CI)

```bash
npm ci
npm run desktop:setup -- --out <a directory outside this repository>
```

The build:

1. checks the source;
2. runs `npm run build`;
3. stages the canonical release (`stageRelease`);
4. obtains the pinned Node runtime and verifies it: SHA-256 plus an x64 PE image;
5. composes and self-verifies the bundle;
6. runs the leak scan (no checkout path, no secret);
7. installs the pinned Inno Setup 6.7.3 per-user into the build directory and verifies it;
8. compiles `dist\QANDEEL-COMPANY-Setup.exe`;
9. records its SHA-256 and Authenticode status in `QANDEEL-COMPANY-Setup.verification.json`.

`npm run desktop:verify -- --dist <out>\dist` re-checks a built artifact.

Pins live in `desktop.pins.json`: the Node version, URL and hashes, Inno Setup, the AppId, the Desktop version and
the icon hash. Downloads, the compiler, the Setup and caches stay in the build directory. Nothing generated is
committed.

### Signing (D-D1-06)

Setup and its uninstaller are Authenticode-signed only when the build environment provides:
- `QANDEEL_SIGN_THUMBPRINT`: a trusted code-signing certificate in the build user's store;
- `QANDEEL_SIGNTOOL`: the Windows SDK `signtool.exe`;
- optionally `QANDEEL_SIGN_TIMESTAMP_URL`.

No credential is ever committed or used by CI. The artifact class is `FOUNDER-RC` only when the signature is `Valid`
and the source is a clean exact commit; otherwise it is `ENGINEERING`. A self-signed or unsigned artifact is never a
Founder release.

## Proofs (D-D1-07)

- `npm run desktop:proof -- --workspace <disposable dir>`
  - **Where:** any machine, including the Founder's, because it is fully disposable. It uses an isolated
    LOCALAPPDATA, an isolated shortcut root and a disposable Company; it never touches the real profile or LIVE.
  - **How:** it runs the INSTALLED CLI on the INSTALLED private runtime, with no Node / npm / Git on PATH. It mirrors
    Setup's file copy instead of running Setup.exe.
  - **What it proves:** packaging, install, runtime, update, rollback, repair, uninstall, reinstall, and the product
    running with the checkout's `packages/` and `node_modules/` unavailable.
- `npm run desktop:e2e -- --workspace <dir> [--artifacts <dir>]`
  - **Where:** a disposable Windows CI runner only. It refuses elsewhere, and wherever any QANDEEL data exists.
  - **What it proves:** the real Setup.exe end to end — first run, invalid choice, per-user install, update, failed
    update rollback, repair, detached, uninstall, reinstall.
  - **Output:** the ENGINEERING Setup artifact.
- `.github/workflows/desktop.yml` runs both, plus `desktop:verify`, on the GitHub Windows runner. It runs as the FULL
  gate's `desktop` job and on any non-main branch push that changes this directory.

The Setup is never built or run locally on the Founder's Smart App Control host during engineering. The real Founder
installation is D2 — Founder Laptop Acceptance.

## Icon (D-D1-03)

`assets/qandeel-company.ico` is derived from the ratified QANDEEL brand authority I-08B2.5 app icon:
- the source is `assets/source/APP_ICON_B_DARK_LUMINOUS.svg`, a one-time byte-exact copy, SHA-256 `859665d8…`;
- it was rasterised once by `assets/render-icon.mjs` (Chromium, exact sizes, no redraw);
- the renders are pixel-identical to the brand package's own renders at every shared size;
- provenance is in `assets/ICON_PROVENANCE.json`.

Nothing depends on the QANDEEL App repository at build or run time.
