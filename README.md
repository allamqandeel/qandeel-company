# QANDEEL COMPANY (قنديل)

QANDEEL COMPANY is a bespoke, local-first AI company built to operate and manage the QANDEEL
product and business. The Founder remains the human Product Authority; the Company's work is
governed and auditable.

> **Separate from the QANDEEL App.** The App is a different repository, product, runtime and data
> boundary. Nothing here imports, reads or writes the App. Future integration happens only through
> the governed `APP-OPS-01` boundary. It is not implemented, and operational telemetry is always
> content-free.

## Current state

| Step | State |
|---|---|
| `L0` Environment Readiness | CLOSED / PASS |
| `C0` Repository Bootstrap | CLOSED / PASS |
| PRE-C1 Authority Sync & Import | Complete (merged). Documentation / authority only |
| `C1` Company Foundation & Durable Runtime | CLOSED / MERGED / CANONICAL (`main` @ `419ee4f`) |
| `C2` Employees + Models + Tools + Cost Governance | **In progress — Cloud implementation candidate, not closed** |

**C1 builds the durable runtime foundation, not the intelligent Company.** It adds:
- Work Items, a durable queue, Runs and checkpoints on SQLite/WAL, with atomic claims, lease fencing
  and bounded retry/dead-letter;
- event-driven wake-up, startup recovery and graceful shutdown;
- an Artifact Store, online backup with isolated verification, and health/readiness;
- an engineering CLI.

C1 itself has no AI subsystem. Details: `docs/c1/C1_SCHEMA_AND_STATE.md`,
`docs/c1/C1_RUNTIME_RECOVERY_MODEL.md`, `docs/C1_IMPLEMENTATION_REPORT.md`.

**C2 (in progress, implementation candidate) adds the governed execution layer.** It covers:
- persistent Employees: identity, lifecycle and history, independent of every model, provider,
  session, run and process;
- a provider-neutral model catalog and Router Policy: `E0..E4`, qualification lifecycle, hard
  privacy / qualification / hold gates before cost, bounded retry ≠ fallback ≠ escalation;
- `D0..D4` data egress;
- R0–R4 authority with default deny and scoped, durable Founder approvals;
- a Tool Registry with a governed Tool Executor;
- hierarchical hard token / cost budgets with worst-case reservation before every call.

All of this runs inside the C1 durable runtime. C2 chooses **no commercial provider**: its only
provider and tools are deterministic fakes, so CI makes no network or paid call and uses no
credential. Details: `docs/C2_IMPLEMENTATION_REPORT.md`, decisions D-C2-01 to D-C2-11.

Still out of scope: Memory / Skills / Academy (C3), Directors / Review Pool (C4), the Founder
Command Center (C5), reporting / learning (C6), APP-OPS (C7) and any QANDEEL App integration.

| Package | Role |
|---|---|
| `@qandeel-company/domain` | Pure contracts: IDs, UTC clock, state machines, retry policy, processor contract |
| `@qandeel-company/governance` | C2 pure policy kernel: Employee lifecycle, R0–R4 authority, `E0..E4` / `D0..D4`, Router Policy, checked economics, provider / tool contracts, typed proposals |
| `@qandeel-company/storage` | Workspace, SQLite/WAL adapter (the only `node:sqlite` user), migrations, repositories, Artifact Store, backup |
| `@qandeel-company/runtime` | Runtime Supervisor, bounded worker pool, recovery, health, CLI; C2 governed Model Runtime, Tool Executor, `c2.employee-task` loop, deterministic fakes |
| `@qandeel-company/bootstrap-contract` | C0 toolchain proof (unchanged) |

**The runtime workspace is separate from Git.** Live Company state
(`state/company.sqlite3`, `artifacts/`, `backups/`, `runtime/`) lives in a workspace directory that
you pass with `--workspace`. It is never inside this checkout and never on a network/mapped drive.
No Founder path is built into the code.

**Cloud sessions work from this repository's authority, not from hidden local context.** The
detailed Stage 0–17 authority is in `docs/authority/company-architecture/`. The one exception is the
Stage 16 source artifact, which is missing and recorded as missing.

## Authority — read before changing anything

1. `docs/authority/COMPANY_CANONICAL_BASELINE.md` — what the Company is and must remain (summary).
2. `docs/authority/company-architecture/README.md` — the index to the detailed canonical Stage
   authority, with provenance in `AUTHORITY_IMPORT_MANIFEST.md`. Where it holds detail, it governs
   over the summary.
3. `docs/authority/IMPLEMENTATION_AUTHORITY_RULES.md` — who decides what; how work is merged.
4. `docs/architecture/IMPLEMENTATION_MAP.md` — work-package sequencing (not evidence of
   implementation).
5. `docs/architecture/BOUNDARIES.md` — boundaries that code must not cross.
6. `docs/architecture/DECISION_LOG.md` — engineering decisions and why.
7. `docs/environment/L0_READINESS_DECISION.md` — Founder-host constraints.

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
| `npm test` | Builds and runs every workspace's `node:test` suite. It includes real-SQLite, multi-process and fault-injection tests, and refuses zero, skipped or todo tests |
| `npm run c1:integration` | Multi-process storage proofs + runtime integration tests (after a build) |
| `npm run c1:faults` | The process-kill fault matrix (after a build) |
| `npm run c1:acceptance -- --workspace <dir>` | C1 local acceptance in a disposable directory (below) |
| `npm run c2:mutation` | Removes 15 C2 authority / budget / tool / routing gates from the build; their proof tests must fail (after a build) |
| `npm run c2:acceptance -- --workspace <dir>` | C2 local acceptance in a disposable directory (below) |
| `npm run verify` | Repository-contract verifier (`scripts/verify-bootstrap.mjs`) |
| `npm run ci` | build → typecheck → lint → test → C1 + C2 mutation checks → verify; the same command CI runs |

### C1 local acceptance (Founder host)

```bash
npm ci
npm run ci
npm run c1:acceptance -- --workspace "D:\QANDEEL-C1-ACCEPTANCE\run-1"
```

- **Choose a directory.** Pick any new or empty directory that is outside every Git checkout; the
  path above is only an example.
- **What it proves:** workspace creation, WAL, migrations, the Work Item lifecycle, the atomic claim,
  crash/restart recovery (a real child process is killed), artifact hashing, online backup, isolated
  verification and restore dry start, and health/readiness.
- **Result and cleanup:** it prints `C1 LOCAL ACCEPTANCE — PASS`, then deletes only the directory it
  created. Pass `--keep` to keep it.
- **What it needs:** no credentials, no provider keys, no network.

### C2 local acceptance (Founder host)

```bash
npm run c2:acceptance -- --workspace "D:\QANDEEL-C2-ACCEPTANCE\run-1"
```

- **What it proves:**
  - the Founder principal, a department and an Employee's lifecycle to `ACTIVE`;
  - the model catalog, Router Policy, tools, grants and budgets;
  - zero provider calls while idle;
  - a governed run with a permitted R1 tool;
  - a D4 context never reaching a lower-ceiling tool;
  - an R3 tool parked for Founder approval and then executed exactly once;
  - a hard budget refusal before any provider call;
  - coherent accounting, health and the read-only CLI.
- **Result and cleanup:** it prints `C2 LOCAL ACCEPTANCE — PASS` and deletes only what it created.
- **What it needs:** no credentials, no provider keys, no network.

### Engineering CLI

After `npm run build`: `node packages/runtime/dist/src/cli.js <command> --workspace <dir>`.

| Command | What it does |
|---|---|
| `init` | Creates and validates the workspace and runs the migrations |
| `start` | Runs the Runtime Supervisor until Ctrl+C |
| `health` | Read-only inspection |
| `submit --kind c1.steps` | Submits deterministic work |
| `cancel --work-item <id>` | Cancels a Work Item |
| `backup` | Online backup |
| `verify-backup --backup <id>` | Verifies a backup in isolation |
| `restore-check --backup <id> --target <empty dir>` | Isolated restore dry start |
| `verify-artifacts` | Re-hashes every artifact object |
| `register-founder` | Registers the single Founder principal (C2) |
| `governance` | Read-only C2 governance health: employees, holds, budgets, approvals, reconciliation |
| `approvals` | Lists pending approvals (IDs, risk, action codes; no content) |
| `approve` / `reject --approval <id> --actor <founder:ref>` | Decides an approval. The actor must be the registered Founder principal; authenticating the human is C5 |

The CLI installs no service, creates no scheduled task and opens no network port.

## Validation

CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run ci` and the C1 and C2 local acceptances on
Windows and Linux for every push to `main` and every PR targeting `main`. The verifier first proves that each of its rules can fail,
then checks the repository: required files and docs, private packages, bounded Node 24 engine, npm
workspaces and lockfile, no tracked `.env` / secret / `node_modules` / SQLite / native-binary files,
no App-repository dependency, no `tar` usage, no APP-OPS implementation, no placeholder packages,
explicit `.gitattributes`, and (locally) `core.longpaths=true`. It also checks:
- the imported authority: every manifest hash, no unlisted or non-Markdown file, and the missing
  Stage 16 recorded;
- that no archives are present;
- that the baseline carries the privacy rules and no stale default-with-exception wording;
- the lifecycle state:
  - `C0` closed;
  - `C1` and `C2` not claimed closed without a closure record;
  - `C2` not started before C1 closes, and `C3` not before C2 closes;
- the C1 boundaries: `node:sqlite` only in the storage adapter, no network code in runtime packages,
  no third-party runtime dependencies, released migrations pinned by SHA-256, and the C1 proof tests
  present;
- the C2 boundaries:
  - provider adapters called only by the governed Model Runtime;
  - tool drivers invoked only by the Tool Executor;
  - budget / reservation / usage writes only in the storage governance modules, behind fenced
    functions;
  - no plaintext secrets or secret-shaped columns;
  - C1 migrations frozen by content;
  - no C3–C7 tables or packages;
  - the C2 proofs and the mutation check present.

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
