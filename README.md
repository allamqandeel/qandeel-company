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
| `C2` Employees + Models + Tools + Cost Governance | CLOSED / MERGED / CANONICAL (PR #3, `d374001`) |
| `C3` Memory + Context + Skills + Academy | CLOSED / MERGED / CANONICAL (PR #4, `4592b52`) |
| `R1` Independent Core Review | CLOSED / MERGED / CANONICAL (PR #6, `bd18614`) |
| `C4` Organization + CEO + Directors + Delegation + Review Pool | IN PROGRESS — implementation candidate, NOT CLOSED (Draft PR) |

**C1 builds the durable runtime foundation, not the intelligent Company.** It adds:
- Work Items, a durable queue, Runs and checkpoints on SQLite/WAL, with atomic claims, lease fencing
  and bounded retry/dead-letter;
- event-driven wake-up, startup recovery and graceful shutdown;
- an Artifact Store, online backup with isolated verification, and health/readiness;
- an engineering CLI.

C1 itself has no AI subsystem. Details: `docs/c1/C1_SCHEMA_AND_STATE.md`,
`docs/c1/C1_RUNTIME_RECOVERY_MODEL.md`, `docs/C1_IMPLEMENTATION_REPORT.md`.

**C2 (closed) adds the governed execution layer.** It covers:
- persistent Employees: identity, lifecycle and history, independent of every model, provider,
  session, run and process;
- a provider-neutral model catalog and Router Policy: `E0..E4`, qualification lifecycle, hard
  privacy / qualification / hold gates before cost, bounded retry ≠ fallback ≠ escalation;
- `D0..D4` data egress (external egress stops at D2 until a qualified D3 egress profile exists);
- R0–R4 authority with default deny and scoped, durable Founder approvals. Founder authority fails
  closed until the authenticated Founder surface (C5), and activation fails closed until C3
  certification (D-C2-13);
- a Tool Registry with a governed Tool Executor;
- hierarchical hard token / cost budgets with worst-case reservation before every call.

All of this runs inside the C1 durable runtime. C2 chooses **no commercial provider**: its only
provider and tools are deterministic fakes, so CI makes no network or paid call and uses no
credential. Details: `docs/C2_IMPLEMENTATION_REPORT.md`, decisions D-C2-01 to D-C2-13.

**C3 (closed / merged / canonical) adds the Employee mind.** It covers:
- governed Employee Memory with a runtime-owned Memory Write Policy: model output is only a
  *candidate*; provenance, confidence caps, duplicates, secrets, staleness, conflicts, corruption
  and Founder corrections are decided by the runtime, and Canonical Truth always outranks memory;
- scoped Company Knowledge (Company / Department / Role / Market / Restricted / Founder-only) with
  exact grants and attributed cross-department use, and the learning path observation → lesson
  candidate → review → validated lesson → promotion (shared promotion waits for independent review);
- **mandatory governed Context Assembly** for every inference: deterministic lexical retrieval over
  a bounded metadata pool, a hard layered budget, progressive Skill disclosure, a stable prefix and
  a content-free Context Manifest to which every model-call reservation is bound;
- the Skill Registry and pipeline (license / dependency check, static inspection, quarantine,
  security review, benchmark, approval), pinned versions, Role Skill Blueprints, Employee Skill
  Passports, freshness / security holds, update impact sets, rollout and rollback; Skill ≠ Tool ≠
  Authority, and no paid Skill packs;
- durable Capability Gaps that park work before any model or tool call;
- the QANDEEL Academy: programs, scenarios and holdouts, attempts executed by the real runtime in
  constrained mode, critical-dimension gating, diagnosis and retraining, shadow work, probation
  review, certification with pinned skills, recertification, loss of a revoked / expired role
  certification (ACTIVE → RETRAINING), and ACTIVE role reassignment without a VALID target-role
  certification (assignment recorded, then RETRAINING), Founder calibration before activation for
  designated roles — and the **activation bridge**, which files an activation request that production cannot approve
  until the authenticated Founder surface exists (C5).

C3 adds no external vector database, embedding service or paid memory service. Details:
`docs/C3_IMPLEMENTATION_REPORT.md`, decisions D-C3-01 onward.

**C4 (implementation candidate, not closed) adds the organization.** It covers:
- the canonical Strong-v1 skeleton, release-seeded and vacant: Founder → a company-scoped **CEO seat** (no
  Department, never a fake Executive Department) → five **Director seats** (Strategic Market Intelligence,
  Growth, Brand & Creative, Product, **Engineering**) with baseline charters; no identity or headcount
  invented;
- Positions and effective-dated **assignments** as organization truth (PRIMARY / bounded ACTING coverage),
  time-correct run attribution, per-placement budget envelopes, headcount as data (seats added, paused,
  re-opened, retired without code);
- **staffing** (Director request with Stage 10 evidence → CEO synthesis → Founder decision, or a capped,
  revocable Founder → CEO delegation → a CANDIDATE hire that the Academy still activates);
- **work delegation** down the reporting line, cross-Department support, refusal / clarification /
  escalation handoffs, with bounded depth and no cycles — work delegation never delegates authority;
- the dynamic **Review Pool** (reviewers qualified by Academy certification, Gold cases and calibration,
  admitted by the Founder — not a Department), review designed before execution and bound to the exact
  output or action, R2 = independent review, R3 = review AND Founder approval, R4 Founder-only,
  conflicts, escalations, Quality Holds and Independent Oversight;
- **P-07**: a deployment that charged a failed attempt is not routed to again for the same Work Item.

Title ≠ Authority throughout: every organizational act needs an explicit grant and the seat. Details:
`docs/C4_IMPLEMENTATION_REPORT.md`, decisions D-C4-01 onward. Still out of scope: the Founder Command
Center and Founder ↔ CEO conversation (C5), reporting / learning dashboards (C6), APP-OPS (C7) and any
QANDEEL App integration.

| Package | Role |
|---|---|
| `@qandeel-company/domain` | Pure contracts: IDs, UTC clock, state machines, retry policy, processor contract |
| `@qandeel-company/governance` | C2 pure policy kernel: Employee lifecycle, R0–R4 authority, `E0..E4` / `D0..D4`, Router Policy, checked economics, provider / tool contracts, typed proposals; C4 organization, delegation and review rules |
| `@qandeel-company/mind` | C3 pure kernel: Memory Write Policy, deterministic retrieval and context planning, compaction, Skill pipeline / licensing / inspection, capability evaluation, Academy rules |
| `@qandeel-company/storage` | Workspace, SQLite/WAL adapter (the only `node:sqlite` user), migrations, repositories, Artifact Store, backup; C4 Organization and Review stores |
| `@qandeel-company/runtime` | Runtime Supervisor, bounded worker pool, recovery, health, CLI; C2 governed Model Runtime, Tool Executor, `c2.employee-task` loop, deterministic fakes; C3 Context Assembler and memory-proposal path |
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
| `npm run c2:mutation` | Removes 19 C2 authority / budget / tool / routing gates from the build; their proof tests must fail (after a build) |
| `npm run c2:acceptance -- --workspace <dir>` | C2 local acceptance in a disposable directory (below) |
| `npm run c3:mutation` | Removes 40 C3 memory / context / skill / academy / Founder-decision gates from the build; their proof tests must fail (after a build) |
| `npm run c3:acceptance -- --workspace <dir>` | C3 local acceptance in a disposable directory (below) |
| `npm run c4:mutation` | Removes 25 C4 organization / delegation / review / P-07 gates from the build; their proof tests must fail (after a build). `-- --shard i/n` runs a disjoint slice |
| `npm run c4:acceptance -- --workspace <dir>` | C4 local acceptance in a disposable directory (below) |
| `npm run verify` | Repository-contract verifier (`scripts/verify-bootstrap.mjs`) |
| `npm run ci` | build → typecheck → lint → test → C1 + C2 + C3 + R1 + C4 mutation checks → verify (CI runs the same proofs, split into parallel jobs) |

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
  - production fail-closed first: without the authenticated Founder surface (C5), Founder
    authority cannot be created or exercised by presenting a reference, and the CLI has no
    Founder write command;
  - then, through the **test-only** Founder seam (loaded only under `--conditions=qandeel-test`,
    never a product path): the Founder principal, a department, activation refused without C3
    certification, an Employee set `ACTIVE` by the seam, and D3 external egress refused;
  - the model catalog, Router Policy, tools, grants and budgets;
  - zero provider calls while idle;
  - a governed run with a permitted R1 tool;
  - a D4 context never reaching a lower-ceiling tool;
  - an R3 tool parked for approval that the CLI cannot approve, then executed exactly once after a
    seam approval;
  - a hard budget refusal before any provider call;
  - coherent accounting, health and the read-only CLI.
- **Result and cleanup:** it prints `C2 LOCAL ACCEPTANCE — PASS` and deletes only what it created.
- **What it needs:** no credentials, no provider keys, no network.

### C3 local acceptance (Founder host)

```bash
npm run c3:acceptance -- --workspace "D:\QANDEEL-C3-ACCEPTANCE\run-1"
```

- **What it proves:**
  - production fail-closed first: no C3 authority act (canonical truth, knowledge, skill pipeline,
    Academy, activation) without the authenticated Founder surface, and no C3 write command on the CLI;
  - then, through the **test-only** Founder seam: the Skill pipeline (an unlicensed skill rejected,
    a paid dependency held for acknowledgement, one skill approved), a Role Skill Blueprint and
    Academy program, and a trainee who is **never** activated by the seam;
  - zero provider calls and zero context assemblies while idle;
  - the Academy path executed by the real runtime in constrained mode (no external action), through
    the governed Context Assembler;
  - certification that does not activate, an activation request production cannot approve, then
    a seam approval that re-checks the evidence and activates;
  - a model-proposed memory stored by policy (capped, attributed), manifest-bound reservations, and
    the memory and pinned skill recalled in a later run;
  - a durable capability gap that parks work without a model call and never re-routes it;
  - content-free health and read-only CLI.
- **Result and cleanup:** it prints `C3 LOCAL ACCEPTANCE — PASS` and deletes only what it created.
- **What it needs:** no credentials, no provider keys, no network.

### C4 local acceptance (Founder host)

```bash
npm run c4:acceptance -- --workspace "D:\QANDEEL-C4-ACCEPTANCE\run-1"
```

- **What it proves:**
  - production fail-closed first: no organization / delegation / Review Pool authority act without the
    authenticated Founder surface, and no C4 write command on the CLI;
  - the canonical skeleton (five Departments, a company-scoped CEO seat, five Director seats), vacant;
  - then, through the **test-only** Founder seam: a company-scoped CEO, a Director and a report placed;
    headcount as data; acting coverage that ends by time;
  - a reviewer certified by the Academy through real runs, calibrated on real shadow reviews and
    promoted on evidence;
  - staffing through Employee runs: Director request → CEO recommendation → delegated decision → a
    CANDIDATE hire;
  - work delegation with the delegator parked at zero tokens until the delegate finishes;
  - output review by the reviewer's own run; R3 = review AND Founder approval, executed exactly once;
  - P-07 across runs; restart durability; content-free health and read-only CLI.
- **Result and cleanup:** it prints `C4 LOCAL ACCEPTANCE — PASS` and deletes only what it created.
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
| `governance` | Read-only C2 governance health: employees, holds, budgets, approvals, reconciliation |
| `approvals` | Lists pending approvals (IDs, risk, action codes; no content) |
| `mind` | Read-only C3 health: memory / knowledge / context / skills / academy counts |
| `capability-gaps` | Open capability gaps (Work Item, Employee, missing codes) |
| `context-manifest --manifest <id>` | One context manifest: selected / rejected IDs, versions, hashes, classes (no content) |
| `organization` | Read-only C4 organization: Departments, seats and holders, executive queues, health (no evidence text) |
| `reviews` | Read-only C4 reviews: live requests, conflicts, holds, Review Pool health (no rationale or instructions) |

The CLI has no Founder write command: a Founder reference typed on a command line is not
authentication. Founder authority arrives with the authenticated Founder surface (C5), and until
then R3 work stays `WAITING_APPROVAL` (D-C2-13).

The CLI installs no service, creates no scheduled task and opens no network port.

## Validation

CI (`.github/workflows/ci.yml`, D-R1-07 / D-C4-08) classifies each change. A documentation-only change
takes a fast, fail-closed docs path (install, build, verifier). Every other change runs the FULL proof
set on Windows AND Linux as parallel jobs (static, tests, sharded mutation checks, C1–C4 acceptances);
the single required status `quality-gate` passes only when every job succeeded and every recorded
mutation ran exactly once per operating system. A push to `main` whose tree is exactly the tree a green
PR run proved takes a fast integrity path; anything else runs the full set. A manual run
(`workflow_dispatch`) always runs the full set. The verifier first proves that each of its rules can fail,
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
  - `C1`, `C2`, `C3` and `C4` not claimed closed without a closure record;
  - `C2` not started before C1 closes, `C3` not before C2 closes, `R1` / `C4` not before C3 closes,
    and `C5` / `C6` / `C7` not before C4 closes;
- the C1 boundaries: `node:sqlite` only in the storage adapter, no network code in runtime packages,
  no third-party runtime dependencies, released migrations pinned by SHA-256, and the C1 proof tests
  present;
- the C2 boundaries:
  - provider adapters called only by the governed Model Runtime;
  - tool drivers invoked only by the Tool Executor;
  - budget / reservation / usage writes only in the storage governance modules, behind fenced
    functions;
  - no plaintext secrets or secret-shaped columns;
  - canonical migrations 0001–0004 frozen by content;
  - no C5–C7 tables or packages (Command Center, Founder ↔ CEO conversation, dashboards, APP-OPS);
  - the test-only Founder seam unreachable from production code, no Founder-attestation
    activation, and no Founder write command on the CLI (D-C2-13);
  - the C2 proofs and the mutation check present;
- the C3 boundaries:
  - Context Assembly mandatory: only the assembler calls the storage assembly, the Model Runtime
    accepts only a context the assembler minted and binds the reservation to its manifest, and the
    model request carries no messages;
  - durable Memory / Knowledge / Skill / Academy state written only by the C3 storage modules,
    memory candidates submitted only by the runtime's memory-proposal path, and no Founder /
    evaluator act called by runtime code or the CLI;
  - skill payloads loaded only by the one pinned, eligibility-checked, hash-verified loader;
  - the `mind` kernel pure (no I/O, storage, runtime, provider or tool driver);
  - no content in C3 audit / events / logs;
  - the `employees_activation_gate` trigger present and no test-seam activation label in
    production code;
  - the C3 proofs and the mutation check present;
- the C4 boundaries:
  - organization / delegation / review state written only by the C4 storage modules, and no Founder
    organization or review act called by runtime code or the CLI;
  - no staffing evidence, handoff message, review rationale or reviewer instructions in telemetry;
  - a review never satisfies R4 (datastore CHECK) and the kernel keeps R4 Founder-only;
  - the Review Pool is not a Department; the seeded Department map is exactly the canonical five;
  - the C4 proofs and the mutation check present;
- the CI contract: triggers, SHA-pinned actions, both operating systems, complete mutation shard
  partitions, the always-running quality gate, and a fail-closed change classifier.

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
