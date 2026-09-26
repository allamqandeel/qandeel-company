# QANDEEL COMPANY — Strong v1
## Stage 13 — Model & Agent Runtime Layer
### Canonical Closure v1

**Status:** CLOSED / ACCEPTED  
**Gate:** D13 — PASS  
**Strong v1 progress after closure:** 77% CLOSED / 23% REMAINING  
**Previous canonical dependency:** QANDEEL_COMPANY_STAGE_12_CANONICAL_CLOSURE_v1.zip

---

## 1. Stage Purpose

Stage 13 defines the model/provider-independent runtime contract that connects:

**Employee + Work Item + Skills + Reasoning Profile → Model / Provider / Runtime choice**

without changing employee identity and without allowing uncontrolled token, cost, delegation, retry, or provider-fallback behavior.

This stage is architectural/governance closure. It does **not** begin production implementation and does not supersede the mandatory Environment Readiness Gate defined before implementation.

---

## 2. Canonical Boundary

The following remain invariant:

- Employee != Model != Session != Run != Process.
- Employee identity persists across model/provider changes.
- QANDEEL owns routing policy, qualification policy, runtime state, cost authority, and execution governance.
- Models/providers/frameworks are replaceable implementation dependencies.
- Deterministic/non-LLM execution is preferred whenever an LLM is unnecessary.
- No silent expensive fallback.
- No agent may self-increase authority, budget, or risk level.
- Idle/waiting employees do not consume LLM tokens.

---

## 3. Accepted Decision Groups

### D13-A — Inference & Routing Contract — ACCEPTED

1. Employee is independent from Agent Run and Model Invocation.
2. QANDEEL owns the Model Contract and Router Policy.
3. QANDEEL uses provider-independent internal reasoning classes:
   - E0 — NO_LLM / deterministic
   - E1 — LIGHT
   - E2 — STANDARD
   - E3 — DEEP
   - E4 — EXTENDED
4. Routing is a governed deterministic policy engine by default, not another free-running LLM agent.
5. Every inference call has a pre-authorized Budget Envelope.
6. Context caching is a first-class runtime optimization but never an architectural dependency or privacy override.

### D13-B — Model Qualification + Routing Matrix — ACCEPTED

1. Qualification applies to a deployment profile, not merely a commercial model name.
2. QANDEEL maintains its own Model Qualification Suite based on real company task classes.
3. No global "best model" ranking is canonical.
4. Routing first applies hard eligibility gates, then optimizes among qualified routes.
5. New models follow Candidate → Benchmark → Shadow → Challenger → Limited Production → Qualified.
6. High-impact production routes use stable/pinned qualified deployments where possible; materially changed deployments trigger relevant requalification.

### D13-C — Adaptive Reasoning & Escalation — ACCEPTED

1. Start at the minimum **sufficient** qualified reasoning level, not mechanically at the cheapest tier.
2. Escalation paths are task-class-specific graphs, not one global staircase.
3. Escalation requires observable evidence; model self-reported uncertainty alone is insufficient authority to spend more.
4. Runtime distinguishes information, reasoning, capability, provider/runtime, and authority/budget failures.
5. Escalation is surgical: escalate the subproblem, not automatically the whole Work Item.
6. Every Run has bounded escalation depth, model/reasoning ceiling, extra-cost ceiling, and attempt ceiling.
7. Retry, fallback, and escalation are separate runtime concepts with separate reasons and policies.

### D13-D — Agent Execution Loop & Delegation Runtime — ACCEPTED

1. The Runtime owns the loop; the Model proposes one governed next action at a time.
2. Runs have explicit limits for turns, tools, retries, delegation depth/fan-out, elapsed runtime, children, and communications.
3. Runs are durable state machines with resumable checkpoints.
4. WAIT is event-driven and effectively token-free; no LLM polling loops.
5. Tool execution remains outside model authority and passes through governed Tool Executors.
6. Delegation creates a formal Child Work Item with lineage, owner, budget, risk, evidence, and stop conditions.
7. Delegation and accountable-owner handoff are distinct operations.
8. Child workers receive a bounded Delegation Envelope rather than the parent's full context/history.
9. Execution traces record auditable runtime events, not private/raw chain-of-thought.
10. No agent framework is made canonical at this stage; framework adoption remains a later build-vs-adopt implementation decision.

### D13-E — Context Assembly & Runtime State — ACCEPTED

1. Context is assembled per inference from relevant canonical truth, work state, skills, memory, evidence, and recent results.
2. Runtime State is durable and separate from Model Context.
3. Every inference has a Context Budget; a large context window is not permission to dump all history.
4. Context items carry provenance/authority/version/freshness/sensitivity metadata; Canonical Truth outranks Memory.
5. Skills/tools/knowledge use progressive disclosure.
6. Prompts use a stable-prefix + dynamic-suffix strategy when useful for caching.
7. Summaries/compaction are derived artifacts, never canonical truth by themselves.
8. Each inference retains a lightweight Context Manifest for auditability.
9. Context efficiency is measured as an operational metric.

### D13-F — Provider Resilience, Quotas & Failure Containment — ACCEPTED WITH SCOPE BOUNDARY

Retained inside Stage 13 only where it directly affects model/provider runtime:

1. Provider errors normalize into a QANDEEL error taxonomy.
2. Retry is bounded and allowed only for appropriate transient failures.
3. Per-deployment circuit breaking prevents repeated calls into unhealthy routes.
4. Fallback is allowed only to a prequalified compatible route and cannot silently exceed the authorized budget or quality/privacy contract.
5. Capacity/quota admission control occurs before calls where provider signals permit it.
6. Provider failure does not crash the Company Runtime; work may queue/wait or use qualified alternatives.
7. Model deprecation/retirement is a governed migration event requiring relevant requalification.
8. Billing/auth/credential failures are operational holds, not retry loops.

**Deferred:** broader disaster recovery, backup, service continuity, and company-wide resilience architecture belong to Stage 15.

### D13-G — Model Economics, Cost Accounting & Budget Enforcement — ACCEPTED WITH SCOPE BOUNDARY

Retained inside Stage 13 only for model/inference/runtime economics:

1. Every model/tool inference-related cost event is attributable through Work Item / Run / Employee / Department lineage.
2. Raw usage and actual monetary cost are both retained.
3. Provider billed cost and internal economic usage are distinct concepts; free/subscription usage is never treated as unlimited.
4. Budgets form hierarchical hard envelopes.
5. Calls reserve authorized worst-case cost before execution and settle actual cost afterward.
6. Retry/fallback/escalation overhead is visible and attributed rather than hidden.
7. Runtime-reported usage can be reconciled later with provider billing/usage records.
8. Routing economics optimize **cost per qualified outcome**, not merely price per token.
9. Large fan-out plans should be forecast before execution.
10. Agents cannot modify their own budget controls or canonical pricing/accounting authority.

**Deferred:** broad company financial reporting, long-horizon employee/department performance analytics, and learning/reporting dashboards belong to Stage 17.

---

## 4. Explicitly Deferred Out of Stage 13

The following are **not** reopened or solved here:

- Data egress classification, provider trust, secrets, credentials, permission architecture, and privacy enforcement → **Stage 14 — Security / Permissions / Secrets**.
- Broad backup/disaster recovery/business continuity and service-resilience architecture → **Stage 15 — Resilience / Backup / Recovery**.
- Founder-facing command surfaces and operational control UI → **Stage 16 — Founder Command Center**.
- Company-wide reporting, performance analytics, learning loops, long-term cost intelligence → **Stage 17 — Reporting / Performance / Learning**.
- Controlled live-company validation and Strong v1 final proof → **Stage 18 — Controlled Pilot → Strong v1 Closure**.

---

## 5. Final Gap Review

### PASS — no Stage-13-blocking product/architecture gap remains.

Stage 13 now defines sufficient contracts for:

- provider/model independence;
- model qualification and route eligibility;
- bounded adaptive reasoning;
- governed retry/fallback/escalation;
- durable one-step agent execution;
- bounded delegation and child work;
- event-driven wait/resume;
- selective context assembly;
- provider-runtime failure containment;
- inference-level cost metering, reservation, and hard budget enforcement.

No additional D13 decision group is required before closure.

The previously contemplated **D13-H — Data Egress / Privacy / Provider Trust** is intentionally **not part of Stage 13** and is carried into Stage 14.

---

## 6. Implementation Preconditions Preserved

Stage 13 closure does not authorize implementation.

Before implementation begins, the already-mandated **Environment Readiness Gate** must PASS, including Windows/PowerShell/Git/GitHub, runtimes/package managers, CLIs/connectors, permissions, services, ports/IPC, long-path handling, certificates/security restrictions, SQLite/WAL/file locking, backup/restore smoke tests, runtime lifecycle, model/provider connectivity, tool connectivity, and pinned/known dependency versions.

A clear Environment Manifest remains required.

---

## 7. Closure Record

**Stage 13 — Model & Agent Runtime Layer: CLOSED / ACCEPTED**  
**Gate D13: PASS**  
**Canonical package:** `QANDEEL_COMPANY_STAGE_13_CANONICAL_CLOSURE_v1.zip`  
**Strong v1 progress:** **77% CLOSED / 23% REMAINING**

Next planned stage:

**Stage 14 — Security / Permissions / Secrets**

Do not reopen Stage 13 unless a real contradiction, implementation proof failure, or downstream requirement requires a formal amendment.
