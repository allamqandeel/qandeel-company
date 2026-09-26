# QANDEEL COMPANY (قنديل)

QANDEEL COMPANY is a bespoke, local-first AI company built to operate and manage the QANDEEL
product and business. The Founder remains the human Product Authority; the Company's work is
governed and auditable.

> **Separate from the QANDEEL App.** The App is a different repository, product, runtime and data
> boundary. Nothing here imports, reads or writes the App. Future integration happens only through
> the governed `APP-OPS-01` contract (not implemented).

## Current state

**C0 — repository bootstrap.** There is **no Company business runtime yet**: no work items,
queues, employees, Directors, model routing, tools, memory or Founder Command Center. The only
package, `@qandeel-company/bootstrap-contract`, proves the toolchain (compile, workspace
resolution, tests, Node 24 runtime). The next stage is
**C1 — Company Foundation & Durable Runtime** (see `docs/architecture/IMPLEMENTATION_MAP.md`).

## Authority — read before changing anything

1. `docs/authority/COMPANY_CANONICAL_BASELINE.md` — what the Company is and must remain.
2. `docs/authority/IMPLEMENTATION_AUTHORITY_RULES.md` — who decides what; how work is merged.
3. `docs/architecture/IMPLEMENTATION_MAP.md` — stage sequencing (not evidence of implementation).
4. `docs/architecture/BOUNDARIES.md` — boundaries that code must not cross.
5. `docs/architecture/DECISION_LOG.md` — engineering decisions and why.
6. `docs/environment/L0_READINESS_DECISION.md` — Founder-host constraints.

## Development model

**Cloud-first build / local-final validation and operation:**
Claude Cloud session → GitHub branch / PR → local fetch or clone → local validation on the
Founder Windows host. Cloud sessions are disposable; nothing canonical lives in them.

## Prerequisites

- Node.js **24** LTS (`.nvmrc`), with its bundled npm 11. Other majors fail `npm ci`
  (`engine-strict`).
- Git. On the Founder host, use GitHub Desktop's bundled Git for HTTPS (see Windows notes).
- No global npm packages, native build tools, databases or services are needed.

## Setup and scripts

```bash
npm ci
npm run ci
```

| Script | What it does |
|---|---|
| `npm run build` | Compiles every workspace with `tsc` into its `dist/` |
| `npm run typecheck` | Type-checks every workspace without emitting |
| `npm run lint` | ESLint over the repository, zero warnings allowed |
| `npm test` | Builds and runs each workspace's `node:test` suite |
| `npm run verify` | Repository-contract verifier (`scripts/verify-bootstrap.mjs`) |
| `npm run ci` | build → typecheck → lint → test → verify; the same command CI runs |

## Validation

CI (`.github/workflows/ci.yml`) runs `npm ci` and `npm run ci` on Windows and Linux for every push
to `main` and every PR targeting `main`. The verifier first proves that each of its rules can fail,
then checks the repository: required files and docs, private packages, bounded Node 24 engine, npm
workspaces and lockfile, no tracked `.env` / secret / `node_modules` / SQLite / native-binary files,
no App-repository dependency, no `tar` usage, no APP-OPS implementation, no placeholder packages,
explicit `.gitattributes`, and (locally) `core.longpaths=true`.

## Windows notes (Founder host)

- **Smart App Control stays on.** It blocks unsigned native executables and DLLs, so the project
  uses only the signed Node runtime and pure-JavaScript dependencies. Do not add native addons or
  locally built executables without a Product Owner decision.
- **Git:** system Git's HTTPS is blocked on this host. Use GitHub Desktop's signed bundled Git
  (`%LOCALAPPDATA%\GitHubDesktop\app-<version>\resources\app\git\cmd\git.exe`; the version folder
  changes when Desktop updates).
- **Long paths:** every local clone needs repository-local `core.longpaths=true`.
- **URL rewrite:** the Founder's global Git config rewrites `https://github.com/allamqandeel/qandeel…`
  to SSH for the App. Clone this repository with the self-mapping that cancels it (decision
  D-C0-06):

  ```bash
  git clone -c core.longpaths=true -c core.quotepath=false -c url.https://github.com/allamqandeel/qandeel-company.insteadOf=https://github.com/allamqandeel/qandeel-company https://github.com/allamqandeel/qandeel-company.git
  ```

- **Backups:** never use Windows `tar.exe` (it crashes on Arabic file names). Use a Unicode-safe
  method.
- **Line endings:** text is LF everywhere (`.gitattributes`); PowerShell files, if added, are CRLF
  and UTF-8 with BOM.

## License

Proprietary — all rights reserved. See `LICENSE.md`.
