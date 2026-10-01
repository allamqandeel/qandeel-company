# Implementation Map

**Status:** CANONICAL sequencing — recorded at C0 (2026-09-26); lifecycle updated at PRE-C1
(2026-09-26), at C1 closure (2026-09-27; `docs/C1_CLOSURE_RECORD.md`) and at C2 start
(2026-09-27: PR #2 was merged into `main` as `419ee4f`, so C1 is CLOSED / MERGED / CANONICAL;
C2 closed and merged on 2026-09-27 as `d374001fa92f27d19aabf97b185ccac3bfc9099d` after exact-SHA independent review and
Founder-host validation), at C3 start (2026-09-27, from `main` @ `f9bd7d4`), and at C3 closure
(2026-09-27; `docs/C3_CLOSURE_RECORD.md`; candidate `4284337221706f08aebe65fadb64c881c8ed9470`
passed independent review, GitHub CI and Founder-host validation), and at C3 merge (2026-09-27: PR #4
merged at closure head `e4fdaa119eeef4cb612e349f962adb38108a62f8` into `main` as
`4592b525bdc4937dd130dac452a7dc8fc29de909`, so C3 is CLOSED / MERGED / CANONICAL), and at R1 closure (2026-09-28: PR #6 merged into `main` as `bd18614d1fc49d3c03ace2289e19accd67aa1838`; exact-head PR CI run #60 and post-merge `main` CI run #62 passed on Windows and Ubuntu; `docs/R1_CLOSURE_RECORD.md`). R1 is CLOSED / MERGED / CANONICAL. C4 closed on 2026-09-29 after PR #8 exact-head CI run #67 passed the full Windows + Ubuntu quality gate; PR #8 merged into `main` as `595083a3a98b4823698ea15eaf3d8efa12965e23`, and post-merge run #68 passed the fast-integrity path. `docs/C4_CLOSURE_RECORD.md` is the closure record. C4 is CLOSED / MERGED / CANONICAL. C5 started on 2026-09-29 from `main` @ `ff7f71cc`; PR #10 exact head `5c4147f6` passed the full Windows + Ubuntu gate (run #81) and merged into `main` as `7c45f2ac105a9b47dd660b01c54eab556521255c`, post-merge run #82 passed the fast-integrity path. `docs/C5_CLOSURE_RECORD.md` (written at the C6 start, 2026-09-30) is the closure record. C5 is CLOSED / MERGED / CANONICAL. C6 started on 2026-09-30 from `main` @ `7c45f2ac`; PR #11 exact head `b282f7d8` passed the full Windows + Ubuntu gate (run #84) and merged into `main` as `b4f91ca3af883907b3c42567a0c757587bec0391` (same tree `e99e18ef`), post-merge run #85 passed the fast-integrity path. `docs/C6_CLOSURE_RECORD.md` (written at the R2 start, 2026-09-30) is the closure record. C6 is CLOSED / MERGED / CANONICAL. R2 started on 2026-09-30 from `main` @ `b4f91ca3` on branch `review/r2-full-strong-v1` and is IN REVIEW (`docs/R2_FULL_STRONG_V1_INDEPENDENT_REVIEW_REPORT.md`). R2 closed on 2026-09-30: PR #12 exact head `ba6f4b7a` passed the full Windows + Ubuntu gate (run #88) and merged into `main` as `2eafbedac0d7c8e60e72d2a2ca48fcc6ff967bc5` (same tree `1053d74a`), post-merge run #89 passed the fast-integrity path. `docs/R2_CLOSURE_RECORD.md` (written at the C7-A start, 2026-10-01) is the closure record. R2 is CLOSED / MERGED / CANONICAL. By Product decision C7 is one roadmap stage implemented as four bounded sub-stages (C7-A Operational Data + External Outcome Core, C7-B Governed App Operations Control Plane, C7-C Pilot Instrumentation Pack, C7-D Marketing, Website & Social Operations; D-C7A-01). C7-A started on 2026-10-01 from `main` @ `2eafbed` on branch `c7a/operational-data-external-outcome-core` as an implementation candidate (`docs/C7A_IMPLEMENTATION_REPORT.md`). C7-A closed on 2026-10-01: PR #13 exact head `4decc904` passed the full Windows + Ubuntu gate (run #93) and merged into `main` as `e7ca688f3a5ac2de5c317fbca31c5dad3dba2a41` (same tree `507ae100`), post-merge run #94 passed the fast-integrity path. `docs/C7A_CLOSURE_RECORD.md` (written at the C7-B start, 2026-10-01) is the closure record. C7-A is CLOSED / MERGED / CANONICAL. C7-B started on 2026-10-01 from `main` @ `e7ca688` on branch `c7b/governed-app-operations-control-plane` as an implementation candidate (`docs/C7B_IMPLEMENTATION_REPORT.md`). C7-B closed on 2026-10-01: PR #14 exact head `ddded00f` passed the full Windows + Ubuntu gate (run #97, final attempt after same-head targeted reruns of infrastructure-only failures) and merged into `main` as `c06fd2e2f0e348efdfdc947322a80b69cf8ff088` (same tree `dd53656d`), post-merge run #98 passed the fast-integrity path. `docs/C7B_CLOSURE_RECORD.md` (written at the C7-C start, 2026-10-01) is the closure record. C7-B is CLOSED / MERGED / CANONICAL. C7-C started on 2026-10-01 from `main` @ `c06fd2e` on branch `c7c/pilot-instrumentation-pack` as an implementation candidate (`docs/C7C_IMPLEMENTATION_REPORT.md`). C7-C closed on 2026-10-01: PR #15 exact head `7739a97a` (after one Technical Lead MAJOR correction of the first reviewed head `2af37b6f`) passed the full Windows + Ubuntu gate (run #100) and merged into `main` as `f450d6a427bf2687c9f9eb9fbb062d6ce4f36b68` (same tree `f298deda`), post-merge run #101 passed the fast-integrity path. `docs/C7C_CLOSURE_RECORD.md` (written at the C7-D start, 2026-10-01) is the closure record. C7-C is CLOSED / MERGED / CANONICAL. C7-D started on 2026-10-01 from `main` @ `f450d6a` on branch `c7d/digital-presence-creation-operations` as an implementation candidate (`docs/C7D_IMPLEMENTATION_REPORT.md`).

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
| `C4` | Organization + CEO + Directors + Delegation + Review Pool | Cloud Mega-Task | CLOSED / MERGED / CANONICAL (PR #8, `main` @ `595083a`) |
| `C5` | Founder Command Center | Cloud Mega-Task | CLOSED / MERGED / CANONICAL (PR #10, `main` @ `7c45f2a`) |
| `C6` | Reporting + Learning + Evaluation + Resilience | Cloud Mega-Task | CLOSED / MERGED / CANONICAL (PR #11, `main` @ `b4f91ca`) |
| `R2` | Full Strong-v1 Independent Review | Review | CLOSED / MERGED / CANONICAL (PR #12, `main` @ `2eafbed`) |
| `C7` | APP-OPS Company Side + Pilot Instrumentation (split into C7-A … C7-D, D-C7A-01) | Cloud Mega-Tasks | IN PROGRESS — C7-A, C7-B and C7-C closed; C7-D implementation candidate (active, not closed) |
| `C7-A` | Operational Data + External Outcome Core | Cloud Mega-Task | CLOSED / MERGED / CANONICAL (PR #13, `main` @ `e7ca688`) |
| `C7-B` | Governed App Operations Control Plane | Cloud Mega-Task | CLOSED / MERGED / CANONICAL (PR #14, `main` @ `c06fd2e`) |
| `C7-C` | Pilot Instrumentation Pack | Cloud Mega-Task | CLOSED / MERGED / CANONICAL (PR #15, `main` @ `f450d6a`) |
| `C7-D` | Digital Presence Creation & Operations (approved scope clarification, D-C7C-12) | Cloud Mega-Task | IMPLEMENTATION CANDIDATE — NOT CLOSED (branch `c7d/digital-presence-creation-operations`) |
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

C4 now satisfies the C5 dependency gate: **CLOSED / MERGED / CANONICAL**, with exact-head full CI and post-merge fast-integrity green. C5 started on 2026-09-29 from `main` @ `ff7f71cc` as an implementation candidate (Attention Orbits Founder Command Center: authenticated loopback Founder surface, durable Goals, Founder-facing communication, Founder Attention, governed confirmation, the Company Universe projection and the browser UI). C5 then closed (PR #10, exact-head run #81, merge `7c45f2a`, post-merge run #82; `docs/C5_CLOSURE_RECORD.md`). C6 — the Company Improvement Engine — started on 2026-09-30 from `main` @ `7c45f2a` as one implementation candidate (evaluation, causal attribution, learning closure, reporting, resilience). C6 then closed (PR #11, exact-head run #84, merge `b4f91ca`, post-merge run #85; `docs/C6_CLOSURE_RECORD.md`). R2 — the full Strong-v1 independent review of C1–C6 as one Company system — is IN REVIEW and STOPPED at its final re-review: three root-cause families (budget-wait resume, C6 evidence time, live-restore crash safety) recurred a third time and are returned to the Technical Lead / Founder for architecture decisions (`docs/R2_FULL_STRONG_V1_INDEPENDENT_REVIEW_REPORT.md` §15). The Product Owner approved one bounded architecture correction (R2-ARCH-CLOSE, report §16): it closed the live-restore crash-safety family and AC-01, but its targeted re-review reproduced MAJOR defects in the corrected budget-admission (RA-1) and learning-evidence-time (RB-1, RB-2) families, so it STOPPED without a patch loop (§16.7). The final simple closure fix (R2-FINAL-SIMPLE-CLOSE, §17) fixed exactly those three and made R2 a closure candidate for Technical Lead exact-head review; R2 then closed (PR #12, exact-head run #88, merge `2eafbed`, post-merge run #89; `docs/R2_CLOSURE_RECORD.md`). C7 is split into C7-A / C7-B / C7-C / C7-D (D-C7A-01): C7-A (governed operational facts and external outcome evidence feeding the existing C6 engine) then closed (PR #13, exact-head run #93, merge `e7ca688`, post-merge run #94; `docs/C7A_CLOSURE_RECORD.md`). C7-B (the governed Company desired-control plane toward the App, without transport) then closed (PR #14, exact-head run #97, merge `c06fd2e`, post-merge run #98; `docs/C7B_CLOSURE_RECORD.md`). C7-C (the Pilot Instrumentation Pack: a Founder-briefed Pilot context over the canonical Goal / Work / Review / C6 systems, projecting evidence without any score) then closed (PR #15, exact-head run #100, merge `f450d6a`, post-merge run #101; `docs/C7C_CLOSURE_RECORD.md`). C7-D (Digital Presence Creation & Operations: the Company's internal digital workshop, safe internal Preview, exact release candidates and governed external promotion — not the QANDEEL website itself) is the active implementation candidate (`docs/C7D_IMPLEMENTATION_REPORT.md`), not closed.
