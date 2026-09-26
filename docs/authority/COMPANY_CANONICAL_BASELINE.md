# QANDEEL COMPANY — Canonical Baseline

**Status:** CANONICAL — recorded at C0 (2026-09-26) from Product Owner decisions already approved.
**Scope:** implementation-facing summary. It records foundations; it does not define schemas,
algorithms or runtime designs. Those belong to C1 and later work packages.
**Changes:** only by Founder / Product Owner decision (see `IMPLEMENTATION_AUTHORITY_RULES.md`).

## 1. Company identity

- QANDEEL COMPANY is a bespoke, local-first AI company created primarily to operate and manage
  the QANDEEL product and business.
- Founder / Product Authority remains **human**.
- **Employee ≠ Model ≠ Session ≠ Run ≠ Process.** These are distinct concepts and must never be
  collapsed into one another in code, data or language.
- Execution is **governed and auditable**.

## 2. Operating principles

- Event-driven by default.
- No LLM polling loops as the authoritative control mechanism. Waiting is a state, not a loop.
- Durable work: accepted work survives restarts.
- Recoverable runtime.
- Bounded retries.
- Idempotency wherever side effects are possible.
- Explicit budgets and hard ceilings.
- Least privilege.
- Tools are not granted automatically.
- High-risk actions require the approved authority path.
- No autonomous self-escalation of authority or budget.

## 3. Organization

The architecture includes Departments, Directors, Employees, delegated work, a Review Pool, the
Founder Command Center, reporting, evaluation and learning, and recovery and resilience.

This baseline names these parts; it does not specify them. Detailed models belong to C1+ and must
follow the upstream Product authority (see `docs/architecture/DECISION_LOG.md`, D-C0-08).

## 4. Founder experience

- Conversational and voice-forward.
- Exception-first.
- The Founder manages Directors, outcomes and important exceptions.
- Not dashboard-first.

## 5. Data and privacy

- QANDEEL COMPANY does **not** receive private QANDEEL conversation text, audio, transcripts,
  Memory or Analysis by default.
- There is **no** routine or exceptional human review of private QANDEEL conversation content as
  part of Company operations or safety monitoring.
- Future APP-OPS operational data is telemetry and operational state only, unless separately
  authorized Product authority establishes otherwise.

## 6. App separation

- The QANDEEL App and QANDEEL COMPANY are separate repositories, runtimes and data boundaries.
- `APP-OPS-01` is a future governed integration contract. C0 does not implement it.

## 7. Strong v1 closure

- The architecture is implementation-ready.
- Implementation begins after C0.
- Strong v1 final closure requires **real controlled Pilot evidence**.
- Do not claim Strong v1 = 100% merely because code or tests exist.

## 8. Implementation baseline (C0)

- TypeScript, Node.js 24 LTS, npm workspaces.
- SQLite family for later local durable state (not created in C0).
- Node built-in / pure-JavaScript capabilities where practical; no native addon unless a later
  task proves it necessary.
- No desktop shell framework is selected. The Founder UI / Windows shell decision is a later
  implementation boundary.
