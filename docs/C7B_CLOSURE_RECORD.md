# C7-B Closure Record

**Status: CLOSED / MERGED / CANONICAL**

C7-B — Governed App Operations Control Plane (the second of the four C7 sub-stages, D-C7A-01) — is closed. This record
was written at the start of C7-C (2026-10-01) from GitHub truth, as the smallest truthful lifecycle sync the C7-C brief
requires. It does not reopen C7-B, does not change any C7-B Product behaviour and does not rewrite the implementation
narrative in `docs/C7B_IMPLEMENTATION_REPORT.md`.

- Implementation: C7-B, Governed App Operations Control Plane (the Company's governed record of issued, desired
  controls toward the App across the seven approved families; R3 proposal → independent review → Founder approval →
  issue; no transport, no applied state)
- PR: #14 (`c7b/governed-app-operations-control-plane`, "C7-B: Governed App Operations Control Plane (candidate, not
  closed)"), merged 2026-10-01T13:40:53Z (4 commits, 34 files)
- Exact reviewed / merged PR head: `ddded00fbff1fb203d2dacc79c3083bc02f57c00`
- Exact-head CI: run #97 (`36847418562`, pull_request on `ddded00`) — final conclusion SUCCESS on run attempt 3; the
  full Windows + Ubuntu proof set (classify, static, tests, acceptance, sharded mutations c1–c7b and r1, `quality-gate`)
- Same-head targeted reruns inside run #97 (validation / infrastructure only, **no production-code change**, no new
  commit — every attempt ran on `ddded00`):
  - attempt 1: `tests (windows-latest)` failed in one runtime fault-injection proof
    (`fault-matrix` "before a checkpoint commits → the uncommitted checkpoint is not trusted"): on the slow Windows
    runner the child runtime waited ~1 s for the supervisor lease, its lease was no longer current when recovery ran,
    and it refused to claim (`SUPERVISOR_NOT_AUTHORITATIVE`, the C1 fail-closed rule), so the harness timed out waiting
    for child output — a timing / supervisor-lease flake, not a defect; `mutation (windows-latest, r1-1of4)` was
    cancelled at the job timeout. The quality gate therefore failed
  - attempt 2: `tests (windows-latest)` re-run on the same head — SUCCESS; the gate still failed only because the
    cancelled `r1-1of4` shard was carried over
  - attempt 3: `mutation (windows-latest, r1-1of4)` re-run on the same head — SUCCESS (every mutation caught);
    `quality-gate` — SUCCESS
- Merge commit on `main`: `c06fd2e2f0e348efdfdc947322a80b69cf8ff088` (parents `e7ca688` and `ddded00`)
- Tree identity: PR head tree = merged `main` tree = `dd53656d4660658af9e0c0c7123a84060c139a10` (verified with
  `git rev-parse <commit>^{tree}` at the C7-C start); the merged tree is exactly the tree run #97 proved
- Post-merge CI: run #98 (`36870478597`, push on `c06fd2e`) — SUCCESS via the fast-integrity path (classify,
  `integrity` Windows + Ubuntu, `quality-gate`; the full matrix was skipped because the tree is the one #97 proved).
  It is not a second full-matrix proof
- Earlier PR #14 runs, for completeness: #95 (`346a2b4`) passed and was superseded by the Technical Lead corrections
  below; #96 (`3931ed6`) was cancelled and superseded by the last proof commit; none is the closure proof
- Migration released with this closure: `0013_c7b_governed_app_controls.sql` (`6eb49123…`), pinned in
  `RELEASED_MIGRATIONS`; 0001–0012 unchanged. 0013 joins the verifier's frozen set in the change after its release
  (C7-C)

## Technical Lead exact-head corrections folded into the merged head

1. **Issue-time authority (D-C7B-09, review of `346a2b4`).** The issue transaction (and the governed APPROVE preview)
   re-decides that the proposer still holds the seat (or acting coverage naming `control.propose`) and that the very
   grant the act was decided under is still ACTIVE, unexpired, R3 and covering the family; the datastore re-checks it
   (`app_control_revisions_authority_current`).
2. **Review Plan supersession (D-C7B-10, review of `346a2b4`).** A STALE control review revokes the approval pending on
   it and rebinds the same proposal to a fresh review of the same exact act; a STALE review never strands a control.
3. **Forward-only proposal proof (`ddded00`).** The forward-only proposal transition list is proved directly
   (`c7b-db-proposal-revivable`), after the D-C7B-10 entry rule made the earlier revival proof vacuous.

BLOCKER / MAJOR at merge: none, after Technical Lead exact-head review of `ddded00`.

## Residuals handed to later stages

As recorded in the implementation report §16 (none is reopened here): R-C7B-01 (no transport / signing / TTL /
App application), R-C7B-02 (no App acknowledgement / applied evidence), R-C7B-03 (no Approved Remote Configuration
family), R-C7B-04 (no planned maintenance window), R-C7B-05 (network / edge rate limiting), R-C7B-06 (no dedicated
Command Center control form), R-C7B-07 (a proposal staled by another revision keeps its open review), R-C7B-08 (no
standing delegated R3 control authority), R-C7B-09 (two aggregate ids for `app_control` events).

## Lifecycle

- The implementation report's header still reads "IMPLEMENTATION CANDIDATE — NOT CLOSED"; that is history and is not
  rewritten (a lifecycle note was appended). This record is the canonical closure statement.
- Review evidence: `docs/C7B_IMPLEMENTATION_REPORT.md`
- Next sub-stage: C7-C, Pilot Instrumentation Pack — started 2026-10-01 from `main` @ `c06fd2e` on branch
  `c7c/pilot-instrumentation-pack` (`docs/C7C_IMPLEMENTATION_REPORT.md`); C7-D is not started.

No C7-C or C7-D functionality is claimed by this closure.
