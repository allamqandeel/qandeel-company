# C2 — Employees + Models + Tools + Cost Governance — Implementation Report

> **C2 CLOUD IMPLEMENTATION CANDIDATE — NOT CLOSED.** There is no C2 closure record. Closure needs
> independent review of an exact SHA and Founder-host validation.

## 1. Baseline, branch, PR

- **Baseline:** `main @ 419ee4f10d6d2fc48ee90cf20e0ad24b28dfc002` (C1 CLOSED / MERGED / CANONICAL;
  PR #2). `main` had not moved when C2 started. The tree was clean.
- **Branch / PR:** `claude/hopeful-pascal-c1f6dk`, one Draft PR (#3). It is not to be merged by
  this task.
- **Lifecycle correction:**
  - the implementation map, README and C1 closure record now say C1 is CLOSED / MERGED / CANONICAL;
  - C2 is "IN PROGRESS — Cloud implementation candidate (not closed)".

## 2. Authority read

Read in full before any edit:
- Stage 1 Constitution, 2 Ontology, 3 Authority / Risk / Governance, 4 Employee Identity /
  Lifecycle;
- Stage 7 Skills / Tools / Capability, 8 Work OS, 12 Local-first Runtime;
- Stage 13 closure, register and handoff; Stage 14 closure, register and handoff;
- Stage 15 closure, for binding recovery rules;
- the canonical baseline, implementation authority rules, implementation map, boundaries and
  C1 documents;
- the Founding Constitution §3 and Stage 11 excerpts, on the Review Pool and independence.

No AUTHORITY CONFLICT was found. Interpretations that the Product Owner may want to refine are
listed in §13.

## 3. Skills and official research

- **Skills.** The installed skills were inspected; none is repository-specific (`.claude/` holds no
  project skills). The materially relevant ones are listed with their effect in §12.
- **Official research.**
  - The Node 24 `node:sqlite` documentation was read: Stability 1.2 (release candidate),
    synchronous `DatabaseSync`, `ERR_OUT_OF_RANGE` above the safe integer range, number binding.
  - `www.sqlite.org` is blocked by the Cloud proxy (as in C1). SQLite 3.53.4 behaviour was probed
    directly, and C2 does no SQL arithmetic (D-C2-10). **Follow-up:** the Founder-host review
    re-reads the sqlite.org pages on integer overflow and STRICT tables.
- **Provider boundary.** C2 is provider-neutral with a deterministic fake provider and fake tools.
  No commercial provider API was used, researched or implemented; no credential exists (D-C2-02).

## 4. Implementation summary

| Area | What exists | Where |
|---|---|---|
| Employees | Durable Employee: stable ID; distinct Egyptian two-part name (Arabic or Latin); profile / personality; Role / Position / Department / Manager refs; Cognitive Profile (`default` / `ceiling` class, cost discipline); lifecycle `CANDIDATE → TRAINING → SHADOW / PROBATION → ACTIVE` + `PAUSED`, `ON_LEAVE`, `RETRAINING`, `SUSPENDED`, `RETIRED`; append-only history; employee principal | governance `employee.ts`; storage `governance.ts`; migration 0004 |
| Identity separation | Founder principal ≠ Employee ≠ runtime `system:runtime`. `run_attributions` bind Run → Employee → Department. Usage records carry deployment, provider, model and session. The Employee row names none of them | `principals`, `run_attributions`, `usage_records` |
| Model catalog | Provider (LOCAL / EXTERNAL, hold, vault reference) → Model → Deployment Profile. A deployment has an immutable pinned revision and reasoning class; qualification `CANDIDATE → BENCHMARK → SHADOW → CHALLENGER → LIMITED_PRODUCTION → QUALIFIED`; per-deployment task classes, egress approval, hold and circuit; immutable versioned price cards | migration 0004; `GovernanceStore` |
| Router Policy | Deterministic and per task class. Hard gates in fixed order: operational → **privacy / egress** → qualification → task class → class → output / context → price card / currency → cost ceiling. Then cheapest eligible worst case. E0 = NO_LLM. Minimum-sufficient class, bounded by the employee ceiling. No global ranking | governance `routing.ts` |
| Retry / fallback / escalation | Retry: same deployment, retryable failures only, bounded per call. Fallback: a prequalified route with the same contract, never costlier than the original unless the policy says so explicitly. Escalation: observable evidence only, bounded depth, never above ceilings. Each is a separately reserved, attributed attempt | `routing.ts`, `model-runtime.ts`, `txReserve` |
| Failure taxonomy | 13 classes → retry / fallback / hold / circuit / sent-uncertain. Auth, billing, quota and deprecation are operational holds, not retry loops. Circuit opens after 3 counted failures for 5 min | governance `providers.ts`; `txDeploymentOutcome` |
| Data / egress | `D0..D4`. The effective class — declared, raised by the result class of every tool result already in context — governs. It is re-derived from durable state per call. Neither the model nor the processor can lower it; an invalid declared class fails closed to D4. D4 is never routed to an external provider (router + approval refusal). Egress approval is explicit per deployment. External tools make their own egress decision | `routing.ts`, `approveEgress`, `txToolIntent` |
| Authority | R0 read · R1 internal · R2 → fail closed (Review Pool is C4) · R3 → scoped Founder approval · R4 → Founder-only, never approvable. Default deny: explicit grants (capability, resource, risk ceiling, data class, expiry, uses). Role / Department / Skill / Model / seniority grant nothing. No self-escalation | governance `authority.ts`; `txToolIntent`; `decideApproval` |
| Approvals | Durable, scoped by subject, action, resource, Work Item, argument digest, data class, risk and limits. Expiry and use count. Survive restart. Changed arguments → new approval. A rejection does not regenerate silently. The C1 `WAITING_APPROVAL` gate now releases through a bound Founder approval (DB triggers re-check) | `approvals`, `approval_history`, 0004 triggers |
| Tools | Tool Registry + immutable action definitions: risk (external mutation ⇒ R3 / R4), side-effect / replay class, idempotency requirement, data-class ceiling **and result class**, strict argument schema, cost; vault reference only. The governed Tool Executor records a durable intent after the full authority path, then calls the driver, then records the result. No shell / execute-anything tool (refused by name) | governance `tools.ts`; `tool-executor.ts`; `tool_invocations` |
| Budgets | Company → Department → Employee → Work Item → Run. Money (micro-units) + tokens. Worst-case reservation before every call, atomic across the chain. Settlement of actual usage releases the unused part. Billed ≠ economic cost (FREE / SUBSCRIPTION still cost and count tokens). Price-card provenance. Overhead attribution. Hard refusal. Checked arithmetic plus DB CHECKs. Overrun recorded truthfully | `economics.ts`, `governance-core.ts`, `txReserve` |
| C1 integration | Governed work is ordinary C1 Work Items / jobs / Runs with checkpoints, leases, fencing, retry / dead-letter and wake generation. The runtime-owned loop `c2.employee-task` (IDEMPOTENT) checkpoints each planned tool call before its effect. Recovery classifies governed orphans. Health gains a `governance` component | `runtime.ts`, `recovery.ts`, `health.ts`, `employee-task.ts` |
| CLI | `register-founder`, `governance`, `approvals`, `approve`, `reject` | `cli.ts` |

**Runtime invariants and how each is enforced:**
- **The runtime owns execution.** The model returns text; `parseProposal` turns it into a closed
  union (`FINAL` / `TOOL_REQUEST` / `INVALID`).
- **Tools are outside model authority.** The Model Runtime holds no Tool Executor, and drivers are
  private to the executor.
- **Natural language never grants.** No proposal type names a grant, approval or budget.
- **Routing only narrows.** It cannot expand authority or budget.
- **Fallback stays inside the envelope.** It is never costlier, and never outside the privacy or
  quality contract.
- **Self-reported uncertainty never escalates.**
- **Secrets never enter state.** Credential columns hold vault references only, secret-named JSON
  keys are refused, and the verifier scans for secret literals.
- **Idle employees make no calls.** Proved by the runtime test and the acceptance.
- **No polling was added.** Waiting on an approval or budget is a C1 `WAIT` woken by the committing
  transaction.

## 5. Migrations

| # | File | SHA-256 (LF) | Content |
|---|---|---|---|
| 1–3 | C1 (unchanged) | pinned; now also frozen by content in the verifier | — |
| 4 | `0004_c2_governance.sql` | pinned in `RELEASED_MIGRATIONS` | departments, employees (+ history), principals, run attributions, providers / models / deployments / price cards, route policies, tools / actions, catalog history, grants, approvals (+ history), `work_items.approval_id` + approval-gate triggers, budgets (+ history), reservations, usage records, tool invocations |

Schema version 4. Every new table is STRICT with no hard delete, has append-only history where
it is history, and carries CHECK constraints for ranges, states and cross-column rules. An older
runtime refuses a v4 database (`SCHEMA_FROM_FUTURE`, as in C1).

## 6. Proofs (automated)

| Mandatory proof | Test |
|---|---|
| Same Employee across model / provider / run / session / process | `runtime/test/c2/governed-runtime.test.ts` "the same Employee works across …" |
| Suspended / retired cannot execute | storage "suspended and retired …"; runtime "suspended Employee …" |
| Default deny; Role alone grants nothing | kernel "default deny"; storage "…Director role and no grants…"; runtime "…another employee without grants…" |
| Self-escalation refused | kernel "governance administration"; storage "self-escalation is refused…" |
| R3 without Founder approval refused; approval survives restart | storage "R3 work: fails closed…" (restart = reopen); runtime "R3 tool … across a restart" |
| Scoped approval fails when arguments change | kernel "approval scope"; storage "R3 tool: scoped Founder approval…" |
| R4 non-Founder refused; R2 blocked | kernel "R2 fails closed … R4 …"; storage "R4 work is Founder-only…", "R1 permitted … R2 … R4 …"; runtime "model output cannot execute a tool…" |
| D4 external route denied; unqualified denied; eligibility before cost; E0 = no LLM | kernel routing tests; runtime identity test (D3 / D4 never external); runtime "E0 = NO_LLM" |
| Expensive / unapproved fallback denied; escalation bounded | kernel fallback / escalation tests; runtime "no silent expensive fallback", "invalid output escalates once…" |
| Unauthorized driver never called; permitted R1 executes; sensitive tool needs approval; no model bypass | runtime "model output cannot execute a tool…", "R3 tool: parks…" |
| Idempotency prevents duplicate mutation | storage "idempotency…"; fault "killed right after a tool intent commits…" |
| Reserve before spend; settlement records actual; unused released | storage "reserve → settle actual…" |
| Concurrent reservations cannot overspend | `storage/test/multiprocess/c2-concurrent-reservations.test.ts` (8 OS processes, cap fits 3) |
| Retry / fallback cost attributed | runtime "retry and fallback are separate, attributed attempts…" |
| Exhausted cap prevents call; self / Company / Department increases | runtime "an exhausted cap prevents the call…"; storage "hard refusal…", "self-escalation…" |
| Coherent after injected crash; explicit reconciliation | storage "crash inside settlement…"; fault "killed right after a model-call reservation commits…" |
| Provider failure does not crash the runtime | runtime "provider auth failure…", "a misbehaving adapter…" |
| Idle runtime: zero provider calls | runtime "idle runtime…"; acceptance `idle-zero-provider-calls` |

Proof markers (verifier `c2-proofs-present`): `C2-PROOF: governance-kernel`,
`storage-governance`, `concurrent-reservations`, `governed-runtime`, `governed-crash-recovery`.

## 7. Mutation checks and verifier

- **`npm run c2:mutation`:** 15 gates, each removed from the compiled output, must make a proof test
  fail:
  - default deny; R4 Founder-only; R3 approval;
  - Founder-only administration; self-approval;
  - budget headroom (caught by storage and by the multi-process race);
  - ineligible employee; denied intent reaching a driver; idempotent replay;
  - call despite a refused reservation;
  - D4 egress; silent expensive fallback;
  - immutable run context; a tool result raising the data class;
  - self-reported-uncertainty escalation.
- **`npm run c1:mutation`:** the C1 check (6 mutations) still runs. Its recovery-guard count went
  from 4 to 5 because the governed recovery is also supervisor-fenced.
- **Verifier:** 8 new rules (D-C2-11). The self-test proves every rule can fail.

## 8. Results (code SHA `19de117`; Node 24.21.0 / SQLite 3.53.4, Linux Cloud)

| Suite | Files | Tests | Result |
|---|---|---|---|
| bootstrap-contract (C0) | 1 | 5 | pass |
| domain (C1) | 2 | 22 | pass |
| governance (C2 kernel) | 1 | 24 | pass |
| storage (C1 + C2, incl. multi-process) | 12 | 134 (C2: 22) | pass |
| runtime (C1 + C2, incl. fault matrices) | 8 | 52 (C2: 17) | pass |
| **Total** | 24 | **237** (C1 174 + C2 63) | **0 failed, 0 skipped** |

- `npm run c1:mutation`: **6/6** caught. `npm run c2:mutation`: **15/15** caught.
- `npm run verify`: self-test proves all 39 rules can fail; **40/40** rules pass (39 + workspace
  resolution).
- `npm run c1:acceptance`: **PASS** (6 steps). `npm run c2:acceptance`: **PASS** (7 steps).
- `git diff --check`: clean.
- **Fresh-clone proof:** a clean `git clone` of the pushed branch at `19de117`, then `npm ci` and
  `npm run ci`, passed with the same counts.
- **Exact-head CI (Windows + Ubuntu):** recorded on PR #3 for the final head. The earlier failed runs
  (`35a248d`, `1ed5d4d`) failed only in the C1 mutation check's guard count; every test passed on
  both OSes in them. Fixed in `19de117` (D-C2-12).

## 9. Security and privacy

- Content-free telemetry (Rule A):
  - audit, event and log fields are IDs, codes, amounts and digests;
  - tool arguments are stored only as a SHA-256 on approvals and invocations;
  - instructions and model output never leave the provider request or the run checkpoint.
- Secrets:
  - none is stored anywhere;
  - `credential_ref` is `vault:<name>` (CHECK + validation);
  - secret-named JSON keys are refused, and secret literals and columns are refused by the
    verifier.
- Rules B and C are untouched: no App path, no human review of App content.
- No network code, child process or native dependency was added to runtime packages (the existing
  verifier and ESLint rules still pass). Windows: pure JavaScript on signed Node; Arabic names and
  paths are covered by tests.

## 10. Honest limits and deferred scope

- **Founder authentication** at a Founder surface is C5. C2 accepts the registered Founder
  reference at the engineering API and CLI (D-C2-04).
- **Certification is C3.** Activation uses Founder-attested evidence references
  (`founder-attestation:`); `academy:` / `certification:` refs are refused (D-C2-05).
- **R2 stays fail-closed** until the C4 Review Pool.
- **Delegated allocation is C4.** Director / manager budget allocation and delegated grants do not
  exist.
- **No real provider adapter** and no vault integration exist yet. A real adapter needs its own
  research, qualification and Founder decision.
- **Stage 13 D13-E.** Context assembly, context budgets and the context manifest belong to C3; C2
  passes the Work Item instructions and tool results only.
- **Reporting** and long-horizon cost analytics are C6 (Stage 17).
- **Budget periods** (monthly resets) are not modelled; caps are lifetime envelopes.
- **Circuit breaking** is per deployment only. Provider-level capacity admission control uses holds.
- **Lexical confinement rules.** `model-calls-confined` and `tool-drivers-confined` are lexical;
  privacy of the registries is the structural guarantee.

## 11. Founder-host / local gate (remaining)

On the Founder Windows host, at the exact final SHA:
1. `npm ci`, then `npm run ci` (includes the C1 + C2 mutation checks and the verifier).
2. `npm run c1:acceptance -- --workspace <new dir>` and `npm run c2:acceptance -- --workspace <new dir>`.
3. Re-read the sqlite.org pages on integer overflow and STRICT tables (Cloud egress gap).
4. Independent review of the exact SHA. The Founder decides on the interpretations in §13.

## 12. Skills used

- **Inspected and not used:**
  - The repository has no project skills.
  - `claude-api` was deliberately not used: C2 chooses no provider, and the task forbids choosing
    one to finish.
  - `session-start-hook`, `update-config`, the artifact / document skills and `init` were not
    relevant.
- **Used, as subagents:**
  - Four focused, read-only review subagents (§14): authority / security, budget, model / tool
    boundary, scope.
  - Effect: 1 BLOCKER, 7 MAJOR and a set of MINOR findings, all in scope and fixed in `19de117`,
    plus the Product Owner list in §13.
- **`code-review` / `security-review`:** not invoked as skills. Their lenses were covered by the
  dedicated reviewers above, run against the exact commit `4178d88`.

## 13. Interpretations to surface to the Product Owner

Each item below is an engineering interpretation adopted for C2. None is a silently invented Product
decision; the Product Owner may confirm or change each one.

- **Execution eligibility.** Only `ACTIVE` executes. `SHADOW` / `PROBATION` execution is left to the
  C3 Academy.
- **Lifecycle transitions.** `SUSPENDED → RETRAINING → SHADOW / PROBATION → ACTIVE`; no direct
  reinstatement.
- **External mutations are ≥ R2.** Any action mutating an external system is registered at R2 or
  above (Stage 3 §2 "sensitive / external").
- **Automatic containment** pauses an Employee after three authority denials in one run.
- **Budget exhaustion parks work** (`WAIT`, token-free) rather than failing it, and a Founder cap
  increase wakes it.
- **Founder-only administration in C2:** grants, all budget caps and qualification. Delegation to
  Directors waits for C4.
- **Currency.** A single Company currency, set on the Company budget.
- **Interim activation.** A Founder attestation is the interim route to `ACTIVE` until the C3
  Academy exists.
- **Default data class.** A missing class defaults to D1 (an invalid one is treated as D4).
- **Containment.** Which signals count, and the threshold of 3.
- **Egress approvals** have no expiry and no endpoint / region / retention conditions yet
  (D14-B.5). Qualification is advanced by Founder decision without a stored Qualification Suite
  result (D13-B.2).
- **Routing economics.** Routing optimizes cheapest worst-case price (D13-G.8 "cost per qualified
  outcome" needs outcome data, C6).
- **Grant scope.** Grants are per tool code or `*`, not per Work Item (just-in-time grants,
  D14-C.5).
- **Founder identity and approval.**
  - The Founder principal is the first registered one.
  - The CLI `approve --actor` is unauthenticated (C5).
  - The Founder cannot approve an approval whose subject is the Founder.
  - Nothing files a work-item approval request automatically.
- **R3 explanations.** Approvals carry no Founder-friendly explanation (what / why /
  recommendation / risk, Stage 3 §3). Likely C5.
- **Stuck R2 work.** R2 work parks as `AWAITING_INDEPENDENT_REVIEW` with no wake until C4.
- **Engineering constants:** circuit 3 failures / 5 min; router-policy bounds.

## 14. Internal review (read-only, exact commit `4178d88`) and dispositions

| # | Lens | Finding | Severity | Disposition |
|---|---|---|---|---|
| 1 | Boundary | Processor-mutable run context: D4 → external provider; ceiling raise | **BLOCKER** | Fixed: frozen context + durable re-derivation per call / reservation; test + mutation |
| 2 | Security | Tool results carry higher-class data into model context | MAJOR | Fixed: `result_data_class`, effective class; test + mutation |
| 3 | Security + Scope | Invalid declared data class silently became D1 | MAJOR | Fixed: invalid → D4 / `INVALID_TASK_INPUT`; tests |
| 4 | Budget | Interrupted tool intent's reservation released although the driver may have run | MAJOR | Fixed: charged (fixed per-call cost), UNSAFE held; test |
| 5 | Budget | A retry superseded a live intent (fence takeover / lost result) | MAJOR | Fixed: `IN_FLIGHT`; dead intents classified like recovery |
| 6 | Scope | `academy:` refs looked like certification | MAJOR | Fixed: reserved kinds refused; Founder-attestation refs; surfaced |
| 7 | Scope | Ordinary model mistakes paused employees | MAJOR | Fixed: containment signals only; test |
| 8 | Budget | Recovery batching could release an UNSAFE reservation | MINOR | Fixed: tool reservations only via invocations |
| 9 | Budget | Parent cap could drop below child caps | MINOR | Fixed + invariant |
| 10 | Budget | Overrun slack hid later overruns | MINOR | Fixed: per-settlement flag |
| 11 | Budget | Invariants missed several corruptions | MINOR | Fixed: 5 more invariants |
| 12 | Budget | Late usage after release lost | NIT | Fixed: discrepancy audit |
| 13 | Security | Retries skipped re-authorization / egress re-check | MINOR | Fixed: re-authorize per attempt; reservation re-checks gates |
| 14 | Security | Model-written names in audit (Rule A) | MINOR | Fixed: registered IDs only; test |
| 15 | Security + Scope | `txDeploymentOutcome` without fence | MINOR | Fixed: run + token required; test |
| 16 | Boundary | Idempotency step from processor unvalidated | MINOR | Fixed: validated. The loop uses the checkpointed step |
| 17 | Boundary | Driver received mutable caller args | MINOR | Fixed: validated, frozen intent args |
| 18 | Boundary | Context-overflow re-escalation from the wrong class | MINOR | Fixed: at most one escalation |
| 19 | Boundary | Lexical confinement rules evadable | MINOR | Fixed: ESLint AST rule (dot / computed / destructuring). Verifier keeps the lexical tripwire |
| 20 | Scope | External mutation allowed at R2 | MINOR | Fixed: R3 / R4 only (kernel + CHECK) |
| 21 | Scope | Founder could not approve a request they filed | MINOR | Fixed: only the subject is excluded; surfaced |
| 22 | Security / Scope | Founder identity is a bearer reference (CLI) | NIT | Deferred to C5 (documented, D-C2-04) |
| 23 | Scope | Egress approvals permanent / unconditioned; qualification without a suite; cheapest-price routing; R2 parks forever; R3 explanation text | MINOR / NIT | Surfaced to the Product Owner (§13); not invented |

No C3–C7 functionality was found, the C1 guarantees were verified intact, and no secrets or App
references were found.
