# C0 — Repository Bootstrap — Closure Record

**Date:** 2026-09-26 · **Mode:** local bootstrap · **Executor:** Claude Code (local, Founder host)

## 1. Final C0 result

**C0 — PASS — COMPANY REPOSITORY READY FOR C1 CLOUD MEGA-TASK**, with the Founder UI steps in §14
still required before the C1 Cloud build starts.

## 2. Local project path

`E:\QANDEEL COMPANY\PROJECT`. It was empty before C0; nothing was overwritten.

## 3. GitHub repository

`allamqandeel/qandeel-company` — `https://github.com/allamqandeel/qandeel-company.git`. It did not
exist before C0. It was created empty (no generated README, license or `.gitignore`) and has no
deploy keys.

## 4. Visibility

**PRIVATE** (verified through the GitHub API after push). Default branch: `main`.

## 5. Initial `main` SHA

`a09070283820e45385457dbebeb25227cec6d458` — `chore: bootstrap QANDEEL Company repository`
(25 files; remote tree verified at 25 blobs). This closure record is completed in the next commit on
`main`.

## 6. Toolchain

| Tool | Version | Basis |
|---|---|---|
| Node.js | 24 LTS (`.nvmrc` = `24`; engines `>=24.11.0 <25.0.0`); Founder host 24.19.0 | Node 24 Active LTS until 2026-10-20, then Maintenance to 2028-04-30 |
| npm | 11.x (engines `>=11.6.0 <12.0.0`); Founder host 11.17.0 | bundled with Node 24 |
| TypeScript | 6.0.3 (exact) | 7.x is native-binary; see DECISION_LOG D-C0-02 |
| `@types/node` | 24.19.0 | |
| ESLint / `@eslint/js` / `typescript-eslint` | 10.11.0 / 10.0.1 / 8.70.1 | |
| Tests | Node built-in `node:test` | no dependency |
| CI actions | `actions/checkout` v7.0.1, `actions/setup-node` v7.0.0, pinned by SHA | current majors on 2026-09-26 |

Dependency tree: 100 lockfile entries, no install scripts, no native or WASM binaries, `npm audit`
0 vulnerabilities.

## 7. Git executable used

GitHub Desktop's bundled Git **2.53.0.windows.4**, Authenticode status **Valid**. It was discovered
at use time as the newest `%LOCALAPPDATA%\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`
(app-3.6.4). Pushes were authenticated per command through the GitHub CLI credential helper, and no
credential was written to any config. System Git was not used for any network or write operation.

## 8. `core.longpaths` proof

`git config --local core.longpaths` → `true` in the canonical clone and in a fresh clone. The
verifier's `local-core-longpaths` rule fails any local clone without it.
Repository-local config also holds `core.quotepath=false` and the URL self-mapping from
DECISION_LOG D-C0-06, which neutralizes the Founder's global App-repo SSH rewrite for this
repository. Proof: outside the repo, the URL resolves to `git@github.com:…`; inside, it stays
`https://…`. The global Git configuration is unchanged.

## 9. Local validation

All run from `E:\QANDEEL COMPANY\PROJECT` on the Founder host:

| Check | Result |
|---|---|
| Clean install (`npm ci` in a fresh clone) | PASS — 99 packages, 0 vulnerabilities |
| build / typecheck / lint / test | PASS — `tsc` clean, ESLint 0 problems, 5/5 tests |
| verifier | PASS — self-test proved that each of the 18 file rules can fail; 19/19 rules passed on 25 files |
| verifier negative proof | FAIL as expected when a placeholder package, a `.dll`, a `tar` call or a missing test directory was planted; PASS again after removal |
| full `npm run ci` | PASS (exit 0) |
| `git diff --check` | PASS |
| line endings | all 25 files LF in index and working tree |
| no untracked output | only ignored `node_modules/` and `dist/`; status clean |
| fresh clone (Desktop Git over HTTPS) + `npm ci` + `npm run ci` | PASS; status clean after the build |
| Arabic text and file name | PASS — README Arabic intact after clone; an Arabic-named file survived commit → clone with a matching hash (disposable, not pushed) |
| QANDEEL App repository | unchanged — clean working tree, HEAD unchanged |

An independent read-only review (subagent) found no blockers and six defects in the verifier and
`.gitignore`. All six were fixed before the first commit:
- a test run that could pass with zero tests;
- a verifier main-guard that could skip silently;
- false positives on `tar` in the lockfile, on source names such as `secret-store.ts`, and on
  `whatsapp-ops`;
- unanchored ignore patterns.

## 10. CI result and branch protection

- **Run 36263647332** on `a0907028`: **success**. Both `ci (windows-latest)` and
  `ci (ubuntu-latest)` passed: `npm ci`, 5/5 tests, verifier 19/19. The run for this closure commit
  is reported in the C0 final response.
- **Branch protection / rulesets:** not available. The GitHub API returns HTTP 403 ("Upgrade to
  GitHub Pro or make this repository public") for both branch protection and rulesets on this
  private repository. Nothing was weakened to work around it: the repository stays private and no
  workaround was invented.
- The protected-`main` intent is recorded in `IMPLEMENTATION_AUTHORITY_RULES.md`. It is enforced by
  process until the Founder upgrades the plan and enables a rule requiring PRs with the `ci` checks,
  with owner bypass.

## 11. Security and secret hygiene

- A tracked-file scan covered GitHub, Anthropic, OpenAI, AWS and npm tokens, private-key headers,
  auth assignments, JWTs, user-profile paths and e-mail addresses: **0 hits in 25 files**.
- The verifier also guards `.env`, secret-named data files, `.npmrc` auth, SQLite / WAL / SHM files,
  native binaries and `node_modules`.
- CI has `contents: read`, `persist-credentials: false`, no secrets and no cache.

## 12. L0 constraints carried forward

- Smart App Control stays on.
- Pure-JavaScript toolchain on the signed Node runtime; TypeScript 7's native compiler is avoided.
- Signed Desktop Git for HTTPS.
- Repo-local `core.longpaths=true`.
- No `tar` (verifier-enforced).
- Unicode-safe files (LF, UTF-8, Arabic proven).
- No security exclusions and no global configuration changes.

## 13. Claude Cloud repository access

**Not verified.** Checking it needs a Founder-authenticated view:
- the GitHub CLI token cannot list GitHub App installations (HTTP 403, needs a GitHub App token);
- the browser extension was not connected;
- no Cloud session was started, to avoid spend.

## 14. User actions remaining before C1

- **USER ACTION REQUIRED BEFORE C1 CLOUD BUILD — Claude GitHub App access.** At
  `https://github.com/apps/claude`, choose **Configure** → the `allamqandeel` account. Under
  **Repository access**, either confirm the app has "All repositories" or add `qandeel-company` to
  "Only select repositories", then **Save**. Confirm that `allamqandeel/qandeel-company` appears in
  the repository picker at `https://claude.ai/code`.
- **Product Owner decision before C1 — upstream authority** (DECISION_LOG D-C0-08). The Stage 0–17
  Company architecture closures exist only as Founder-local archives, and a Cloud session sees only
  this repository. Either import them into `docs/authority/`, or put what C1 needs into the C1 task
  package.
- **Optional.** Upgrade to GitHub Pro to enforce protected `main` (§10). Run `claude auth login` in
  a terminal only if Cloud sessions will be started from the standalone CLI.

## 15. Skills used

| Skill | Concrete effect |
|---|---|
| `security-review` | Invoked; failed to load. Its preamble runs `git log origin/HEAD...` in the session's working directory (the App repository), and it reviews a branch diff against `origin/HEAD`, which a repository with no commits yet does not have. The equivalent independent review ran as a read-only subagent (§9). |

No other installed Skill was materially relevant. The rest cover UI, design, animation, React
Native or documents.

## 16. Anti-scope confirmation

Not implemented:
- Work Item runtime, Run engine, queues, scheduler or event bus;
- Company SQLite schema or migrations;
- employees, Directors, departments, delegation, collaboration or the Review Pool;
- model router, provider adapters, inference or prompt framework;
- tool runtime, permissions or risk engine, budgets or cost;
- memory or context, Skills runtime, Academy or evaluation;
- Founder Command Center, voice, APP-OPS, telemetry or remote controls;
- release, deployment, Windows Service, Electron / Tauri or code signing.

No C1 branch was created. The only package is `bootstrap-contract` (metadata plus a pure
Node-version check).

## 17. Next task

`C1 — Company Foundation & Durable Runtime — CLOUD MEGA-TASK`
