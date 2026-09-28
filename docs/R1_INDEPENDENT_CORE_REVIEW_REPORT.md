# R1 — Independent Core Review Report

**Status:** R1 — IN PROGRESS — FINDINGS RECORDED BEFORE REMEDIATION — NOT CLOSED

This revision records the verified findings of the R1 adversarial review **before** any remediation
(R1 contract §12, step 1). It is superseded by the final revision of this same file.

- Baseline: canonical `main` = `c6a17c30c008e5d5ce04fca86f21b069cce4fe7f` (PR #5 merged; post-merge CI
  run `36350272891` SUCCESS on `windows-latest` and `ubuntu-latest`).
- Branch: `review/r1-independent-core-review`.

## Findings register (pre-remediation)

Severity per R1 contract §11. "Angle" names the independent finder(s) that reported it; two angles
reporting the same mechanism independently is noted.

### MAJOR

| ID | Invariant | Finding | Angle(s) |
|---|---|---|---|
| R1-01 | Secrets never enter memory / SQLite / prompts (Stage 12 §23, Stage 14 D14-A.4 / D-6, D-C3-03) | The secret detector (`mind/src/text.ts` `SECRET_LITERALS`) misses common credential formats (Anthropic `sk-ant-api03-…`, Stripe `sk_live_`, JWT, `Bearer <tok>`, JSON-quoted `"password":`, `github_pat_`, `ya29.`, URL credentials); a missed secret is stored as ACTIVE memory and re-sent to the provider. Tool results are stored raw in `tool_invocations.result_json`; candidate `claimValue` is never scanned; step results are truncated **before** the scan. | memory/context; security (independent) |
| R1-02 | Model output is untrusted data (D14-A.6); strict tool-argument validation (Stage 12 §11/§51) | `validateArgs` looks fields up on a plain object, so model-proposed keys named after `Object.prototype` members (`constructor`, `toString`, `hasOwnProperty`, …) skip the unknown-key and every type/length check and reach the driver and the approval fingerprint. | security; tools (independent) |
| R1-03 | Idempotency key identifies one logical action (D-C2-07, Stage 8 §40); ordinary failures never pause (Stage 3 §9) | Tool keys are `wi:<workItem>:s<step>` but the loop's step counter is per **job** (checkpoints are per job). A re-released / reworked Work Item's new job restarts at step 0: equal args silently REPLAY a stale result, different args are refused as `IDEMPOTENCY_CONFLICT`, which counts toward the automatic authority pause. | tools; durable work (independent) |
| R1-04 | Reconciliation is Founder authority, fail-closed without the authenticated surface (D-C2-04, D-C2-13) | The C1 job-level `resolveReconciliation` (ordinary `CompanyStore` / `CompanyRuntime` API, opaque unauthenticated actor) resolves a **governed** run's `RECONCILIATION_HOLD`: `CONFIRMED_COMPLETED` completes the governed Work Item and releases its dependents while the C2 tool invocation stays `RECONCILIATION_REQUIRED` with its money held. | seams |
| R1-05 | Dependents run only once dependencies are satisfied (D-C1-21) | `releaseApprovedWorkItem` (approval → `READY`) enqueues without the dependency check the ordinary release path performs; approval-gated work runs while its dependency is unfinished. | seams |
| R1-06 | No lost wake (D-C1-23); WAIT is event-driven | A Founder approval / rejection or budget-cap raise committed while the job is still `CLAIMED` (between `APPROVAL_REQUIRED` / `BUDGET_EXHAUSTED` and the WAIT settle) finds no `WAITING` job to wake; the settle then parks it `AWAITING_APPROVAL` / `BUDGET_EXHAUSTED` forever (restart does not help). C3 waits already re-check at the settle; C2 waits do not. | durable work |
| R1-07 | No lost wake (D-C1-23); a resolved capability gap wakes the same work (D-C3-09) | A `TOOL_ACCESS_MISSING` capability gap is not woken when the Founder issues the missing grant (`GovernanceStore.grant` never wakes gaps). | skills/academy |
| R1-08 | Concurrency cap, cancellation delivery, controlled shutdown (Stage 12 §9–§10, §28) | After an in-process lease loss the pump re-claims the job while the old processor is still in its abort grace; the old run's `finally` deletes the new run's `#active` entry, so the live processor escapes the concurrency cap, `cancel()` and `stop()`. | durable work |
| R1-09 | Provider misbehaviour is contained; a possibly-billed call is held (D13-F.1/.8, D-C2-07) | An error in the post-call bookkeeping (`settleReservation` of an out-of-range usage sum, or any store error after the provider answered) escapes `GovernedModelRuntime.call`: the reservation stays `RESERVED` (not held for reconciliation), the deployment is not held, and C1 retries call the same deployment again. | routing/cost |
| R1-10 | Failed / refused behaviour cannot be hidden (Stage 6 §6/§9, D-C3-16 N2) | An attempt's refusals are discarded when the attempt is voided by `startAttempt` or `withdrawEnrollment` (only `evaluateDeterministic` scores them); a shadow Work Item that ends `CANCELLED` / `SUPERSEDED` is never collected, so its refusals never become probation evidence. | skills/academy |
| R1-11 | Active duty in a role requires that role's certification (Stage 4 §8; D-C3-24) | D-C3-24's demotion runs only for an `ACTIVE` Employee. A `PAUSED` / `ON_LEAVE` Employee reassigned to a role it holds no certification for resumes to `ACTIVE` in that role and executes ordinary work (latent: Founder writes fail closed in production). | identity/authority |
| R1-12 | Scope / privacy filtering before the LIMIT; deterministic bounded retrieval (D-C3-16 N4, D13-E) | The term-index pools apply data-class ceiling, market and review-horizon eligibility **after** the SQL `LIMIT`; ineligible memories (and knowledge above the ceiling) crowd an eligible item out of the bounded pool. | memory/context |
| R1-13 | Precedence: a lower layer never overrides a higher one (D-C3-06, Stage 5 §7, D14-A.6) | Model-authored memory text (and knowledge / step results) is rendered verbatim, so it can forge higher-layer section markers (`[L1 AUTHORITY — binding …]`) inside the provider-bound context. | memory/context |
| R1-14 | Released migrations are immutable (CLAUDE.md; Stage 12 §37) | The verifier freezes only 0001–0004 by content; released 0005 / 0006 can be edited and re-pinned with CI green. | sqlite |
| R1-15 | Proofs cannot be silently removed (Stage 11 §5/§18) | The test runner checks vacuity for the whole run, not per file (a proof file emptied to its marker comment passes CI); mutation scripts are not pinned (a script replaced by a comment passes CI). | proof quality |

### PRODUCT OWNER DECISION REQUIRED (surfaced, not decided)

| ID | Question | Source |
|---|---|---|
| P-01 | Role reassignment of an `ON_LEAVE` Employee (no `ON_LEAVE → RETRAINING` transition exists) | identity/authority |
| P-02 | Should Stage 3 §9 automatic containment also apply to trainees (TRAINING / SHADOW / PROBATION / RETRAINING)? | tools |
| P-03 | Consequence of `SECURITY_HOLD` / `RETIRED` on a skill version pinned by a VALID role certification; evidence required to lift a hold | skills/academy |
| P-04 | Who may start a step above the Cognitive Profile default reasoning class, and is it escalation overhead? | routing/cost |
| P-05 | Does an IMPORTANT memory-conflict hold also gate a pending tool execution (not only inference)? | seams |
| P-06 | Are unsalted content hashes in operational output content-free under Rule A? | security |

### MINOR

Recorded individually in the final revision (§7), with disposition (fixed / recorded for later).
