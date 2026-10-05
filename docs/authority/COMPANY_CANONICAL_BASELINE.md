# QANDEEL COMPANY — Canonical Baseline

**Status:** CANONICAL — recorded at C0 (2026-09-26) from Product Owner decisions already approved;
reconciled at PRE-C1 Authority Sync & Import (2026-09-26).
**Scope:** implementation-facing summary. It records foundations; it does not define schemas,
algorithms or runtime designs. Those belong to C1 and later work packages.
**Detailed authority:** the imported Stage 0–17 canonical closures in
`docs/authority/company-architecture/` (start at its `README.md`). **This baseline summarizes them
and does not replace them.** Where they hold detailed authority on a subject, implement from them,
not from this summary.
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

This baseline names these parts; it does not specify them. Their detailed authority is the imported
stage set (`docs/authority/company-architecture/`):
- Departments and Directors: Stage 10.
- Employees: Stages 4–7.
- Work and delegation: Stage 8.
- Review Pool: Stage 11.
- Runtime: Stages 12–13.
- Security: Stage 14.
- Recovery: Stage 15.
- Reporting and learning: Stage 17.
- Founder Command Center: the Stage 16 source artifact is **missing** from the local authority set;
  see that directory's `README.md` §5.

## 4. Founder experience

- Conversational and voice-forward.
- Exception-first.
- The Founder manages Directors, outcomes and important exceptions.
- Not dashboard-first.

## 5. Data and privacy

The Product Owner decided these three rules directly; they were restated at PRE-C1. They are
separate rules. None is an exception to another, and none is weakened by a default or an
unspecified exception.

- **Rule A — Operational telemetry is ALWAYS content-free.** Operational telemetry contains no
  private conversation text, audio, transcripts, prompts, model-output content, Memory content,
  Analysis content or equivalent private semantic payload. There is no incident or
  safety-monitoring exception.
- **Rule B — APP-OPS-01 itself provides no path by which Company Operations receives private user
  content.** A future path in which a user deliberately chooses to share selected private content
  for support would be **outside** APP-OPS-01. No such path exists now; it would need separate,
  explicit Product authority before it could exist.
- **Rule C — No routine or exceptional human review of private QANDEEL conversation content is
  authorized through Company Operations or safety-monitoring flows.**

This baseline defines no moderation or replacement safety mechanism, and it does not amend QANDEEL
App authority.

## 6. App separation

- The QANDEEL App and QANDEEL COMPANY are separate repositories, runtimes and data boundaries.
- `APP-OPS-01` is the governed App ↔ Company operational boundary.
  - Its App-side Product / Architecture contract is **CLOSED / FROZEN** in the App's Product track
    (lifecycle sync recorded at the C7-A start, 2026-10-01; it was a candidate when this baseline was
    first written). Approval of an operational domain there does not mean the App already emits it.
  - The Company side is implemented in `C7`, split into C7-A … C7-D (see the implementation map).
    C7-A (closed) adds only the Company-side governed intake contract (content-free operational facts
    and governed external outcome evidence). C7-B (closed) adds only the Company-side
    governed record of issued (desired) operational controls. C7-C (closed) adds only Company-internal
    Pilot instrumentation; an issued control is never a Pilot outcome. C7-D (closed) builds Company-side digital
    presence capability and reads nothing from the App. **No live App ↔ Company transport or
    connector exists yet, and no Company-issued control is effective in the App until the App runtime
    itself applies it.**
  - Operational telemetry stays content-free (Rule A), APP-OPS-01 carries no private user content
    (Rule B), and the Company and the App stay separate.

## 7. Strong v1 closure

- The architecture is implementation-ready. Its Stage 0–15 and Stage 17 closures are in the
  repository; the Stage 16 source artifact is missing (see §3).
- Implementation begins after C0, starting with C1.
- Strong v1 final closure requires **real controlled Pilot evidence**.
- Do not claim Strong v1 = 100% merely because code or tests exist.

## 8. Implementation baseline (C0)

- TypeScript, Node.js 24 LTS, npm workspaces.
- SQLite family for later local durable state (not created in C0).
- Node built-in / pure-JavaScript capabilities where practical; no native addon unless a later
  task proves it necessary.
- No desktop shell framework is selected. The Founder UI / Windows shell decision is a later
  implementation boundary.
