# Implementation Map

**Status:** CANONICAL sequencing — recorded at C0 (2026-09-26); lifecycle updated at PRE-C1
(2026-09-26), at C1 closure (2026-09-27; `docs/C1_CLOSURE_RECORD.md`) and at C2 start
(2026-09-27: PR #2 was merged into `main` as `419ee4f`, so C1 is CLOSED / MERGED / CANONICAL;
C2 closed and merged on 2026-09-27 as `d374001fa92f27d19aabf97b185ccac3bfc9099d` after exact-SHA independent review and
Founder-host validation), at C3 start (2026-09-27, from `main` @ `f9bd7d4`), and at C3 closure
(2026-09-27; `docs/C3_CLOSURE_RECORD.md`; candidate `4284337221706f08aebe65fadb64c881c8ed9470`
passed independent review, GitHub CI and Founder-host validation), and at C3 merge (2026-09-27: PR #4
merged at closure head `e4fdaa119eeef4cb612e349f962adb38108a62f8` into `main` as
`4592b525bdc4937dd130dac452a7dc8fc29de909`, so C3 is CLOSED / MERGED / CANONICAL), and at R1 closure (2026-09-28: PR #6 merged into `main` as `bd18614d1fc49d3c03ace2289e19accd67aa1838`; exact-head PR CI run #60 and post-merge `main` CI run #62 passed on Windows and Ubuntu; `docs/R1_CLOSURE_RECORD.md`). R1 is CLOSED / MERGED / CANONICAL. C4 is READY / NOT STARTED.

This is **sequencing, not evidence**. A stage listed here is not implemented until its own work
package is merged to `main` with green CI and the required review. The implementation packages
below are not the Product / Architecture Stages 0–18 in `docs/authority/company-architecture/`.

| Stage | Name | Mode | State |
|---|---|---|---|
| `L0` | Environment Readiness | Local | CLOSED / PASS |
| `C0` | Repository Bootstrap | Local | CLOSED / PASS |
| `C1` | Company Foundation & Durable Runtime | Cloud Mega-Task | CLOSED / MERGED / CANONICAL (PR #2, `main` @ `419ee4f`) |
| `C2` | Employees + Models + Tools + Cost Governance | Cloud Mega-Task | CLOSED / MERGED / CANONICAL (PR #3, `d374001`) |
| `C3` | Memory + Context + Skills + Academy | Cloud Mega-Task | CLOSED / MERGED / CANONICAL (PR #4, `main` @ `4592b52`) |
| `R1` | Independent Core Review | Review | CLOSED / MERGED / CANONICAL (PR #6, `main` @ `bd18614`) |
| `C4` | Organization + CEO + Directors + Delegation + Review Pool | Cloud Mega-Task | READY / Not started |
| `C5` | Founder Command Center | Cloud Mega-Task | Not started |
| `C6` | Reporting + Learning + Evaluation + Resilience | Cloud Mega-Task | Not started |
| `R2` | Full Strong-v1 Independent Review | Review | Not started |
| `C7` | APP-OPS Company Side + Pilot Instrumentation | Cloud Mega-Task | Not started |
| `L1` | Local Integration & Acceptance | Local | Not started |
| `P1` / `P2` / `P3` | Controlled Pilots | Local operation | Not started |
| — | Strong v1 Closure | Evidence gate | Not started |

**PRE-C1 Authority Sync & Import** ran between `C0` and `C1`. It prepared the repository for Cloud
execution by importing the canonical authority, and it is not a Product / Architecture stage or an
implementation package. Its record is `docs/PRE_C1_AUTHORITY_SYNC_CLOSURE.md`.

## Rules

- C1–C7 are **intentionally large** Cloud work packages.
- Development model: **Cloud-first build → GitHub branch / PR → local fetch / clone → local
  validation.** Local validation on the Founder Windows host remains required after Cloud work.
- Nothing in the canonical operating state may depend on a Cloud session VM after the work
  package ends.
- The map is refined only when a real engineering dependency requires it, not to create more tasks.
- Strong v1 closes only on real controlled Pilot evidence (see
  `docs/authority/COMPANY_CANONICAL_BASELINE.md` §7).

- **Cross-stage integration is mandatory from C4 onward (D-R1-02).** A stage is never designed or
  reviewed as an isolated feature:
  - **Backward integration gate:** read and preserve every closed-stage contract / invariant the
    stage touches; map its reads, writes, authority checks, retries, accounting, lifecycle transitions
    and durable state to the existing canonical mechanisms; never create a parallel mechanism where a
    canonical one should be extended.
  - **Forward integration gate:** read the known next-stage / Product requirements before implementation
    and preserve the extension seams they already require, without inventing unknown future behaviour.
  - **Boundary-first design:** identify high-risk cross-stage boundaries before coding and state the
    invariant plus preferred architecture in the task itself. Authority, money, durable lifecycle,
    recovery, privacy, routing and external / mutable-data boundaries get focused adversarial proofs
    during implementation, not only at a later mega-review.
  - **R1 non-regression:** R1 findings are defect-family lessons, not literal one-off patches. A repeated
    root-cause family is an architecture signal and stops autonomous patch loops.
  - **Bounded validation:** implementation uses fast / focused gates. The complete CI + mutation +
    verifier + acceptance suite runs once on the real closure-candidate exact head. A post-full-gate
    MINOR is recorded without restarting the gate; a BLOCKER / MAJOR stops for Technical Lead
    disposition. Two correction cycles are the maximum for one root-cause family; a third recurrence
    requires architecture review before more coding.
  - **Cross-stage closure evidence:** each closure records the prior-stage contracts touched, evidence
    they remain valid, the new contracts exposed to the next stage, residuals / deferred Product
    decisions, and confirmation that no later-stage scope leaked in.

## Roadmap intent clarification after R1

The canonical sequence remains **C4 → C5 → C6 → R2 → C7 → L1 → Controlled Pilots → Strong v1**.
The implementation intent is now explicit so each stage is designed as part of one Company system:

- **C4** builds the real organization foundation: a persistent **CEO executive Employee** between Founder
  and Directors; Directors / Positions; the canonical Strong-v1 Departments / Charters — **Strategic
  Market Intelligence, Growth, Brand & Creative, Product, and Engineering** — staffing requests;
  bounded delegation / handoff; and the qualified Review Pool, while extending — not duplicating —
  C1–C3 runtime, authority, memory, skills and Academy mechanisms. CEO title grants no
  authority by itself; initial staffing approval remains Founder-controlled until explicitly delegated.
- **C5** consumes C4 to build the Founder Command Center: the high-frequency Founder↔CEO operating
  relationship, organization visibility, approvals / delegation controls and the Company Calendar
  foundation. The CEO must be able to synthesize Department needs and bring decision-ready staffing /
  priority proposals to Founder.
- **C6** consumes real work lineage from C1–C5 for CEO / Director / employee / Department performance,
  reporting, learning, evaluation, resilience and outcome analytics. Performance is outcome- and
  attribution-based, not activity-count based; campaign / content / traffic performance becomes visible
  when those external result sources exist.
- **C7** connects governed Company operations to APP-OPS / Pilot instrumentation and external outcome
  data without weakening the earlier privacy, authority, accounting or recovery boundaries.

R1 now satisfies the C4 dependency gate: **CLOSED / MERGED / CANONICAL**, with required post-merge CI green. C4 may start from canonical `main` after this closure/docs-sync is merged.
