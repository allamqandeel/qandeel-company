# Implementation Authority Rules

**Status:** CANONICAL — recorded at C0 (2026-09-26).

1. **Product Owner decisions outrank executor convenience.** An executor never trades a Product
   decision for an easier implementation.
2. **Canonical `main` is implementation truth** as work is merged into it. Unmerged branches,
   Cloud session state and local working copies are not.
3. **Architecture documents guide implementation and are not silently rewritten by it.** If code
   and an architecture document disagree, surface the disagreement; do not edit the document to
   match the code.
4. **New Product decisions require Founder approval.** A missing Product decision is reported as a
   gap, not invented.
5. **Ordinary engineering choices are the executor's** inside a frozen Product / Architecture
   boundary (naming, internal structure, libraries that respect the constraints, test design).
   Record material ones in `docs/architecture/DECISION_LOG.md`.
6. **Significant architecture deviations are surfaced before implementation**, not after.
7. **Every large Cloud work package defines**, before work starts:
   - exact scope;
   - explicit anti-scope;
   - tests / proof;
   - migration / recovery impact;
   - security implications;
   - cost implications;
   - review requirements.
8. **Independent review uses an exact commit or PR head SHA**, never "the latest branch".
9. **No merge solely because the implementing agent says its work is correct.** Merge requires
   green canonical CI and the review the work package names.
10. **C1+ work is sized as substantial work packages**, not tiny token-wasting Cloud tasks.
11. **Detailed imported authority governs within its scope** (added at PRE-C1). When
    `docs/authority/company-architecture/` holds detailed canonical authority for a subject, do not
    implement from the short C0 summary alone. Imported sources are never edited to fit an
    implementation. If an imported source and a later direct Product Owner decision conflict,
    record `AUTHORITY CONFLICT — PRODUCT OWNER REVIEW REQUIRED` and do not choose silently.

## Protected `main` intent

From C1 onward every change reaches `main` through a branch and pull request with green CI. Direct
pushes to `main` are reserved for Founder break-glass administration. The enforcement status on
GitHub is recorded in `docs/architecture/DECISION_LOG.md` (D-C0-09).
