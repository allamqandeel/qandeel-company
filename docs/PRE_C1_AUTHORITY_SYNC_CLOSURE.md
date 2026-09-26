# PRE-C1 — Canonical Authority Sync & Import — Closure Record

**Date:** 2026-09-26 · **Mode:** local only · **Executor:** Claude Code (local, Founder host)
**Nature:** documentation / authority preparation for Cloud execution. This is not a Product /
Architecture stage, not `C1`, and it contains no Company runtime code.

## 1. Exact baseline SHA

`main` = `origin/main` = `08c74175520706027c5305c3d0435d25aeac3cca`, the expected baseline. Truth
check before any work:
- local and remote are equal (ahead 0 / behind 0);
- the working tree is clean;
- the only branch is `main`;
- the repository is `PRIVATE`;
- the last `main` CI runs, 36263849187 and 36263647332, both succeeded.

## 2. Branch / PR

- Branch `docs/pre-c1-authority-sync-import`, created from the exact baseline.
- Draft PR: https://github.com/allamqandeel/qandeel-company/pull/1, titled "docs: import Company
  authority for C1 cloud execution". **Not merged.**
- Commits: `0b1a6906492d4c45b7b4a7f536f4221c8f2b432b` (the import), then one follow-up commit
  with the review fixes and this record's final sections. The PR head is that follow-up commit.

## 3. Local authority search scope

- **Searched:** `E:\QANDEEL COMPANY\` only. The repository's own `PROJECT\` tree was excluded, and
  so were `.git`, `node_modules` and `dist`.
- **Not searched:** other folders and drives.
- **Found:** 18 ZIP archives and no other files.
- **How they were read:** read-only through .NET `ZipArchive`, never `tar.exe`, into a disposable
  scratch directory outside the repository.

## 4. Discovered stage / source inventory

There are 18 archives with 264 Markdown entries between them. Every entry is UTF-8, LF, has no BOM
and ends with a newline. The table below shows how each group was classified from the documents'
own status and closure statements; `AUTHORITY_IMPORT_MANIFEST.md` §1 and §3 hold the per-file
detail.

| Group | Entries | Classification |
|---|---:|---|
| `FOUNDATION_v0.1` package | 5 | SUPERSEDED — pre-Stage-0 draft (every file has a later version) |
| Per-stage documents, Stages 0–12, in their own stage package | 26 | CLOSED / FROZEN + FINAL CLOSURE RECORD — imported |
| The same per-stage documents repeated in later cumulative bundles | 156 | byte-identical duplicates (verified per file) — not imported |
| Running documents, Stage 12 version (constitution, master plan, change log, register) | 4 | CANONICAL / FINAL (constitution, master plan) and EVIDENCE ONLY (log, register) — imported |
| Running documents, earlier versions (S00–S11), and the S00–S12 bundle READMEs | 61 | SUPERSEDED, or EVIDENCE ONLY for the S12 README — not imported |
| Stage 13, 14, 15 and 17 standalone packages | 12 | FINAL CLOSURE RECORD + CLOSED / FROZEN — imported |
| **Total** | **264** | 42 imported + 66 not-imported manifest rows (the 5 FOUNDATION entries plus these 61) + 156 duplicates |

No artifact needed `UNKNOWN — REQUIRES REVIEW`. Choices never relied on file timestamps.

## 5. Imported canonical authority inventory

42 files in `docs/authority/company-architecture/`, with original file names:
- `FOUNDING/` (4);
- `STAGE_00/`–`STAGE_12/` (2 each);
- `STAGE_13/`, `STAGE_14/`, `STAGE_15/`, `STAGE_17/` (3 each).

The index is `README.md`; provenance is in `AUTHORITY_IMPORT_MANIFEST.md`. No archives, images or
other binaries were added.

## 6. Provenance / SHA result

- **All 42 imported files:** source-entry SHA-256 = imported-file SHA-256 (exact copies, no
  normalization).
- **Archives:** each archive's SHA-256 is recorded too.
- **Generation:** the manifest tables were generated from the archive entry streams.
- **Ongoing checks:** `npm run verify` recomputes every imported hash on each run, locally and in CI.
  It fails on any mismatch, on an unlisted file, on a non-Markdown file, and on a `SUPERSEDED` or
  `UNKNOWN` row.

## 7. Missing sources

**STAGE 16 SOURCE ARTIFACT — NOT FOUND IN LOCAL AUTHORITY SET.**
- Stage 16 is Founder Command Center. No archive, directory or entry for it exists.
- It was not reconstructed, and nothing was inferred from Stage 15 or Stage 17. No `STAGE_16/`
  directory exists.
- No later canonical source explicitly restates a Stage 16 decision. The related planning material
  and adjacent-scope later authority are listed in the index (§5).
- Stage 16 maps to `C5`. It does not block `C1`.

## 8. Conflicts found

**No `AUTHORITY CONFLICT — PRODUCT OWNER REVIEW REQUIRED`.** Five non-blocking observations are
recorded in the index (§6):
- O1: gate-name drift;
- O2: plan versus closure for Stage 13;
- O3: stale Stage-12-era status lines;
- O4: a "Working Record" title with CLOSED status;
- O5: "voice-forward" is a direct Product Owner decision absent from the imported set.

Privacy check: no imported source assumes human review of App content, moderation, or an App →
Company content path (index §7).

## 9. C0 lifecycle correction

`IMPLEMENTATION_MAP.md`:
- `C0` changed from "Current task" to **CLOSED / PASS**;
- `L0` stays **CLOSED / PASS**;
- `C1` is **NEXT — CLOUD MEGA-TASK**.

PRE-C1 is noted beneath the table as preparation, not as a stage. The map also states that the
implementation packages are not the Product Stages 0–18.

## 10. Privacy semantic correction

The C0 wording in the baseline §5 and in `BOUNDARIES.md` excluded private content "by default",
with an unspecified "unless separately authorized" exception. It was replaced by three distinct
rules (DECISION_LOG D-PRE-C1-02):
- **A.** Operational telemetry is ALWAYS content-free, with no incident or safety-monitoring
  exception.
- **B.** APP-OPS-01 itself provides no path by which Company Operations receives private user
  content. User-initiated support sharing is outside APP-OPS-01, is not established, and needs
  separate explicit Product authority.
- **C.** No routine or exceptional human review of private QANDEEL conversation content is
  authorized through Company Operations or safety-monitoring flows.

APP-OPS-01 is now described as the governed future boundary. It is still a candidate on the App
side: the App-side document, merged to App `main` through `allamqandeel/qandeel#278`, has the status
`PRODUCT / ARCHITECTURE CONTRACT CANDIDATE — NOT FROZEN`. It is not implemented in the Company
(`C7`). This task did not amend the App's CW2-08 and did not invent a moderation mechanism.

## 11. README / CLAUDE reading-path correction

- **`README.md`.** It shows the lifecycle table (L0 / C0 closed, PRE-C1, C1 next and intended for
  Claude Cloud, not started) and the rule that Cloud sessions work from repository authority, not
  hidden local context. It adds the authority index to the reading list.
- **`CLAUDE.md`.** It gives the required nine-step reading order and the rule "When detailed
  imported canonical authority exists for a subject, do not implement from the short C0 summary
  alone." It also says:
  - imported sources are not to be edited;
  - Stage 16 is not to be reconstructed;
  - the three privacy rules apply.
- **Other documents.** `IMPLEMENTATION_AUTHORITY_RULES.md` gains rule 11 (same rule, plus the
  conflict procedure). The baseline points each named subsystem to its stage.

## 12. Verifier changes

Four rules were added to `scripts/verify-bootstrap.mjs`:
- `authority-import-integrity`;
- `no-archive-dumps`;
- `privacy-hard-boundaries`;
- `implementation-lifecycle-state`.

The required docs now include the index, the manifest and this record. The self-test gained
multiple violation scenarios per new rule. It also gained **must-pass** scenarios, which prove the
rules are stage-aware:
- C1 may be marked closed once a `docs/C1_*CLOSURE*.md` exists;
- a future Stage 16 import with a manifest row is accepted.

The package allowlist was kept: it is already stage-aware, because the change that adds a real
package extends it (D-PRE-C1-04). `.gitattributes` exempts only the imported source directories from Git
whitespace checks and line-ending normalization (`-text -whitespace`). This preserves their
Markdown hard line breaks and their exact bytes.

## 13. Validation

All run on the Founder host (Windows, Node 24, GitHub Desktop's bundled Git) unless marked CI.
- `npm ci`: 0 vulnerabilities, no package or lockfile change.
- `npm run ci` (build, typecheck, lint, test, verify): exit 0. Tests 5/5. Verifier 23/23 rules on
  70 files; its self-test proves each of the 22 file rules can fail and that the legitimate future
  states (C1 closed with its record, a properly listed Stage 16 import) pass. Re-run after the
  review fixes: same result.
- `git diff --check`: clean.
- **Fresh clone** of the branch at `0b1a6906`: `npm ci`, then verify 23/23.
- **Hashes:** an independent PowerShell SHA-256 recomputation of all 42 manifest rows found 0
  mismatches. The reviewer separately recomputed all 42 from the ZIP entry streams: 0 mismatches.
- **Planted violations** in a disposable clone, each failing its intended rule, with the clone
  restored clean afterwards:
  - one changed byte in an imported file;
  - one appended space;
  - an invented `STAGE_16/` file;
  - a force-added `.zip`;
  - stale "by default" privacy wording;
  - a weakened Rule A;
  - `C0` set back to "Current task";
  - `C1` marked closed without a closure record.

  `C1` marked closed *with* a `docs/C1_*CLOSURE*.md` record passed.
- **CI** on `0b1a6906`: run 36265218131, success on `ubuntu-latest` and `windows-latest`. CI on
  the follow-up head is reported in the PR.

## 14. Independent review result

An independent, read-only review agent reviewed `0b1a6906` against `08c74175`. **Verdict: PASS
WITH FIXES, no blocker.**

What it verified:
- all 42 hashes, from the ZIP entry streams;
- all 18 archive hashes;
- the 264-entry accounting;
- the Stage 16 handling;
- every cited stage reference;
- a privacy sweep of the whole imported set;
- the lifecycle;
- the anti-scope (no package, lockfile or runtime change; no secrets);
- the verifier (read and run).

Findings and disposition:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Major | D-PRE-C1-03 and §10 called App PR #278 open; it merged as `576b010` | Fixed: both now say merged; APP-OPS-01 is still a candidate, not frozen |
| 2 | Minor | §4 table double-counted the 5 FOUNDATION entries (269, not 264) | Fixed: 61, with a total row |
| 3 | Minor | "CANONICAL / FINAL" overstates the founding documents' own status | Fixed in the index §3: each row states its own status (`LIVING / VERSIONED`; `ACTIVE PLANNING / EDITABLE`) and that later closures govern. The manifest label is kept (the task's taxonomy); its Notes already disclose this |
| 4 | Minor | The verifier checked only the imported-SHA cell, so an edit plus a matching cell edit passed | Fixed: each row must be `exact` with source SHA = imported SHA; a new self-test scenario proves it |
| 5 | Minor | Index §5 omitted evidence that a Stage 16 closure once existed | Fixed: a pointer for the Product Owner, explicitly not a reconstruction |
| 6 | Nit | O2 quoted non-verbatim text | Fixed: exact sub-stage names |
| 7 | Nit | Index §7 and `CLAUDE.md` shortened Rules B and C | Fixed: both quote the exact rules and defer to baseline §5 |
| 8 | Nit | The "by default" pattern could reject a legitimate later sentence | Fixed: scoped to the baseline and `BOUNDARIES.md` |
| 9 | Nit | Imported files could still be line-ending normalized | Fixed: `-text` on the imported source directories; no blob changed |
| 10 | Nit | The privacy sweep could list Stage 5 §8 and Stage 10 §10–11 | Fixed: listed, no conflict |

## 15. App repo unchanged proof

**This task made no change to the App repository.** Every command it ran there was read-only: status,
log, `rev-parse`, reflog, and reading the APP-OPS-01 candidate's status line. It did not check out,
fetch, commit, stage or write.

At the start of this task the App repository was clean on `42b0bc5`. During the task its state was
changed by **another actor**, and the App's own reflog shows this:
- App PR #278 merged to `main` as `576b010` (22:02 +0300);
- at 22:10 a checkout moved to `docs/p4-b-cw2-08-no-human-review-amendment`;
- at 22:15 commit `3e4cf2a` was made there ("docs: amend CW2-08 human-review authority").

That is App Product-track work. This task neither caused nor touched it, did not amend CW2-08, and
imported no App document.

## 16. Cloud access status

**Not verified.** No Cloud session was started, and no promotional credit was used. The GitHub
CLI token cannot list GitHub App installations (HTTP 403 at C0; a GitHub App token is needed), and
no zero-cost visibility check is available from this host.

## 17. Exact remaining Founder action

**USER ACTION REQUIRED BEFORE C1 CLOUD BUILD**
1. Go to `https://github.com/apps/claude`, choose **Configure**, then the `allamqandeel` account.
2. Under **Repository access**, grant `allamqandeel/qandeel-company`: add it under "Only select
   repositories", or confirm "All repositories" is already set. Do not widen access beyond what is
   needed.
3. **Save**.
4. Confirm `allamqandeel/qandeel-company` appears in the repository picker at
   `https://claude.ai/code`.

Also, review and merge this Draft PR. After that, C1 may rely on the imported authority.

## 18. Exact next work package

`C1 — Company Foundation & Durable Runtime — CLOUD MEGA-TASK`
