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

`APP-OPS-01` is described as a governed future boundary. Its App-side contract is a candidate on
2026-09-26; App PR `allamqandeel/qandeel#278` is open and not merged. There is no Company-side
integration.

## D-PRE-C1-04 — Verifier extended, stage-aware

`scripts/verify-bootstrap.mjs` gains four rules:
- `authority-import-integrity`. Every manifest row resolves to a file, and every hash matches. No
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

Imported sources keep their Markdown hard line breaks. `.gitattributes` turns Git's whitespace
checks off for the imported source directories only.
