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
- Draft PR: *PR_PLACEHOLDER*, titled "docs: import Company authority for C1 cloud execution".
  **Not merged.**

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
| Running documents, earlier versions (S00–S11) and all bundle READMEs | 66 | SUPERSEDED, or EVIDENCE ONLY for the S12 README — not imported |
| Stage 13, 14, 15 and 17 standalone packages | 12 | FINAL CLOSURE RECORD + CLOSED / FROZEN — imported |

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

APP-OPS-01 is now described as the governed future boundary, still a candidate on the App side
(App PR `allamqandeel/qandeel#278` is open and unmerged). It is not implemented in the Company
(`C7`). The App's CW2-08 was not amended, and no moderation mechanism was invented.

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
package extends it (D-PRE-C1-04). `.gitattributes` exempts only the imported source directories
from Git whitespace checks, which preserves their Markdown hard line breaks.

## 13. Validation

*VALIDATION_PLACEHOLDER*

## 14. Independent review result

*REVIEW_PLACEHOLDER*

## 15. App repo unchanged proof

*APP_PLACEHOLDER*

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
