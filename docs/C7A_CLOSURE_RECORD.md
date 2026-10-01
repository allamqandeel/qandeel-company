# C7-A Closure Record

**Status: CLOSED / MERGED / CANONICAL**

C7-A — Operational Data + External Outcome Core (the first of the four C7 sub-stages, D-C7A-01) — is closed. This
record was written at the start of C7-B (2026-10-01) from GitHub truth, as the smallest truthful lifecycle sync the
C7-B brief requires. It does not reopen C7-A, does not re-run its design and does not rewrite the implementation
narrative in `docs/C7A_IMPLEMENTATION_REPORT.md`.

- Implementation: C7-A, Operational Data + External Outcome Core (governed content-free operational facts and governed
  external outcome evidence feeding the existing C6 engine)
- PR: #13 (`c7a/operational-data-external-outcome-core`, "C7-A: Operational Data + External Outcome Core (candidate,
  not closed)"), merged 2026-10-01T07:59:19Z (5 commits, 43 files)
- Exact reviewed / merged PR head: `4decc9047abd8bf5ab8ef4662027a705cfd3aa7d`
- Exact-head CI: run #93 (`36830473117`, pull_request on `4decc90`) — SUCCESS; the full Windows + Ubuntu proof set
  (classify, static, tests, acceptance, sharded mutations c1–c7a and r1, `quality-gate`)
- Merge commit on `main`: `e7ca688f3a5ac2de5c317fbca31c5dad3dba2a41` (parents `2eafbed` and `4decc90`)
- Tree identity: PR head tree = merged `main` tree = `507ae100d3dc94b0a1bc3879d0f7927cdc844057` (verified with
  `git rev-parse <commit>^{tree}` at the C7-B start); the merged tree is exactly the tree run #93 proved
- Post-merge CI: run #94 (`36833567709`, push on `e7ca688`) — SUCCESS via the fast-integrity path (classify,
  `integrity` Windows + Ubuntu, `quality-gate`; the full matrix was skipped because the tree is the one #93 proved).
  It is not a second full-matrix proof
- Earlier PR #13 runs, for completeness: #90 (`194599c`) and #91 (`6a70c5e`) failed and were superseded by the
  Technical Lead corrections below; #92 (`e895bcf`) passed and was superseded by the last correction; none is the
  closure proof
- Migration released with this closure: `0012_c7a_operational_data_external_outcomes.sql` (`31eeff9a…`), pinned in
  `RELEASED_MIGRATIONS`; 0001–0011 unchanged. 0012 joins the verifier's frozen set in the change after its release
  (C7-B)

## Technical Lead exact-head corrections folded into the merged head

1. **Late integrity conflict / current truth (D-C7A-11, review of `194599c`).** A conflicting replay of a record a
   verification already cited now contests that verification in the conflict's own transaction (datastore trigger);
   C6 trusts only a current verification, states a contested one as conflicting evidence, restates the Work Item's
   evaluations through the same evaluator, and the Founder resolves it by UPHOLD / REPLACE / RETRACT. History is never
   rewritten.
2. **Datastore contract enforcement (D-C7A-10, review of `194599c`).** The contract catalogue is datastore state seeded
   from the same definitions; a source registers only a catalogued version and digest for its family, and two triggers
   make every record conform to its registered contract even when TypeScript is bypassed.
3. **Contested pattern reuse (D-C7A-11, review of `e895bcf`).** A successful pattern whose originating outcome became
   contested is never planned for a new reuse, and an open reuse of it is cancelled (forward-only CANCELLED, history
   kept); UPHOLD / a valid REPLACE re-open only future reuse.

BLOCKER / MAJOR at merge: none, after Technical Lead exact-head review of `4decc90`.

## Residuals handed to later stages

As recorded in the implementation report §12 (none is reopened here):

- **R-C7A-01** No live transport: `ingest` is an in-process seam; App-side Production Integration and L1 call it later.
- **R-C7A-02** Contracts are release code; a new metric or event type is a new contract version and a Founder
  registration.
- **R-C7A-03** The C7-A structured intents are reachable through the governed preview API only (no dedicated Command
  Center form).
- **R-C7A-04** Refusal audit rows are content-free but unbounded per misbehaving producer — **handed to C7-B** (the
  Company-side storage-amplification part) **and L1 / Production Integration** (network / edge rate limiting).
- **R-C7A-05** Objective windows, staleness and success thresholds belong to C7-C.
- **R-C7A-06** Suspending a source affects new verifications only; past verifications stay current truth.
- **R-C7A-07** Per-user pseudonyms are not retained; automated per-user reliability processing needs its own design.
- **R-C7A-08** The 0012 header comment names APP-OPS-01 (SQL comments are outside `no-app-ops-implementation`).
- **R-C7A-09** A contested verification never reverses the Work Item lifecycle; a verdict change needs a Product
  decision.
- **R-C7A-10** A causal attribution already VALIDATED on a contested NOT_ACHIEVED outcome is not reopened.

## Lifecycle

- The implementation report's header still reads "IMPLEMENTATION CANDIDATE — NOT CLOSED"; that is history and is not
  rewritten (a lifecycle note was appended). This record is the canonical closure statement.
- Review evidence: `docs/C7A_IMPLEMENTATION_REPORT.md`
- Next sub-stage: C7-B, Governed App Operations Control Plane — started 2026-10-01 from `main` @ `e7ca688` on branch
  `c7b/governed-app-operations-control-plane` (`docs/C7B_IMPLEMENTATION_REPORT.md`); C7-C and C7-D are not started.

No C7-B, C7-C or C7-D functionality is claimed by this closure.
