# Implementation Map

**Status:** CANONICAL sequencing — recorded at C0 (2026-09-26).

This is **sequencing, not evidence**. A stage listed here is not implemented until its own work
package is merged to `main` with green CI and the required review.

| Stage | Name | Mode | State |
|---|---|---|---|
| `L0` | Environment Readiness | Local | CLOSED / PASS |
| `C0` | Repository Bootstrap | Local | Current task |
| `C1` | Company Foundation & Durable Runtime | Cloud Mega-Task | Next |
| `C2` | Employees + Models + Tools + Cost Governance | Cloud Mega-Task | Not started |
| `C3` | Memory + Context + Skills + Academy | Cloud Mega-Task | Not started |
| `R1` | Independent Core Review | Review | Not started |
| `C4` | Organization + Directors + Delegation + Review Pool | Cloud Mega-Task | Not started |
| `C5` | Founder Command Center | Cloud Mega-Task | Not started |
| `C6` | Reporting + Learning + Evaluation + Resilience | Cloud Mega-Task | Not started |
| `R2` | Full Strong-v1 Independent Review | Review | Not started |
| `C7` | APP-OPS Company Side + Pilot Instrumentation | Cloud Mega-Task | Not started |
| `L1` | Local Integration & Acceptance | Local | Not started |
| `P1` / `P2` / `P3` | Controlled Pilots | Local operation | Not started |
| — | Strong v1 Closure | Evidence gate | Not started |

## Rules

- C1–C7 are **intentionally large** Cloud work packages.
- Development model: **Cloud-first build → GitHub branch / PR → local fetch / clone → local
  validation.** Local validation on the Founder Windows host remains required after Cloud work.
- Nothing in the canonical operating state may depend on a Cloud session VM after the work
  package ends.
- The map is refined only when a real engineering dependency requires it, not to create more tasks.
- Strong v1 closes only on real controlled Pilot evidence (see
  `docs/authority/COMPANY_CANONICAL_BASELINE.md` §7).
