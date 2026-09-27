# Implementation Map

**Status:** CANONICAL sequencing — recorded at C0 (2026-09-26); lifecycle updated at PRE-C1
(2026-09-26), at C1 closure (2026-09-27; `docs/C1_CLOSURE_RECORD.md`) and at C2 start
(2026-09-27: PR #2 was merged into `main` as `419ee4f`, so C1 is CLOSED / MERGED / CANONICAL;
C2 closed and merged on 2026-09-27 as `d374001fa92f27d19aabf97b185ccac3bfc9099d` after exact-SHA independent review and
Founder-host validation), at C3 start (2026-09-27, from `main` @ `f9bd7d4`), and at C3 closure
(2026-09-27; `docs/C3_CLOSURE_RECORD.md`; candidate `4284337221706f08aebe65fadb64c881c8ed9470`
passed independent review, GitHub CI and Founder-host validation), and at C3 merge (2026-09-27: PR #4
merged at closure head `e4fdaa119eeef4cb612e349f962adb38108a62f8` into `main` as
`4592b525bdc4937dd130dac452a7dc8fc29de909`, so C3 is CLOSED / MERGED / CANONICAL). R1 and C4 are not
started.

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
| `R1` | Independent Core Review | Review | Not started |
| `C4` | Organization + Directors + Delegation + Review Pool | Cloud Mega-Task | Not started |
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
