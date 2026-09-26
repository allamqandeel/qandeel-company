# QANDEEL COMPANY — STAGE 0
## Product Definition & Boundaries — Working Record v0.1
**Status:** CLOSED / ACCEPTED  
**Opened:** 2026-09-26  
**Gate:** A0 — PASSED  
**Weight:** 3% of Strong v1

---

# 0. Purpose

Stage 0 answers one question:

> **What exactly are we building, for whom, for what operating purpose, and what must Strong v1 include or explicitly exclude?**

No implementation choice is frozen here unless it is necessary to define the product boundary.

---

# 1. Already-established founder decisions

The following are treated as current founder direction unless explicitly changed:

1. QANDEEL COMPANY is a system we will build, not purchase.
2. External research is for learning from prior attempts, obstacles, and user feedback.
3. Company headquarters are local-first on a QANDEEL-owned laptop.
4. The system must remain portable and not depend on one machine or one AI provider.
5. Employees must be trained before active duty.
6. Employee identity must survive model/session replacement.
7. Employees must retain role, work context, learning, and organizational continuity.
8. Employees must communicate directly with each other and continue work asynchronously.
9. Responsibilities are distinct but complementary.
10. Employees have supervised room for innovation.
11. Founder should normally interact with department directors, while retaining direct access to any employee.
12. Employees should understand QANDEEL, the Egyptian market, and relevant global best practice.
13. SEO is a strategic capability.
14. Employees should learn from mistakes and improve over time.
15. Founder needs a command center/dashboard for the company.
16. Strong v1 should be ready early enough for pre-launch training, market observation, correction, and supervised practice.

---

# 2. Stage 0 sub-stages

## 0.1 Product Statement
Define QANDEEL Company OS in one precise paragraph.

## 0.2 Founder Operating Model
Define what Mohamed should and should not have to manage personally.

## 0.3 Strong v1 In-Scope
Define capabilities required for Strong v1.

## 0.4 Explicit Out-of-Scope
Define what we intentionally refuse to build in v1.

## 0.5 Constraints
Local-first, hardware, budget, providers, privacy, operating assumptions.

## 0.6 Success Definition
Define what must be demonstrably true before we call Strong v1 successful.

## 0.7 Research Questions Register
List unresolved questions requiring research before downstream design.

---

# 3. Decision Set A — Product identity — APPROVED

### A1 — What is the system primarily?
**APPROVED**

> QANDEEL Company OS is a local-first operating system purpose-built for QANDEEL, enabling Mohamed as Founder to manage the entire company through persistent, trained AI employees and department directors.

### A2 — Is it QANDEEL-specific or a generic platform?
**APPROVED: QANDEEL-specific for Strong v1.**

The architecture should remain clean enough not to block future generalization, but Strong v1 will not spend scope on SaaS, multi-company onboarding, or generic-company productization.

### A3 — Is Mohamed the only human operator in Strong v1?
**APPROVED: Yes, as the primary human operator / Founder.**

The architecture must not prevent future human operators or managers, but multi-human collaboration is not a Strong v1 requirement.

### A4 — Does Strong v1 operate only QANDEEL App, or the full QANDEEL business?
**APPROVED: The full QANDEEL company.**

The application is the first and most important product, but the company system must be able to support Product, Engineering, Growth, SEO, Brand, Market Intelligence, Finance, Operations, and future company functions.

---

# 4. Decision Set B — Autonomy boundary — APPROVED

## B0 — Governing principle
**APPROVED**

> Autonomy in QANDEEL is earned, scoped, budgeted, observable, and revocable.

No employee or director receives unrestricted autonomy by default.

Every meaningful autonomous action must remain bounded by:
- role authority;
- approved scope;
- risk level;
- cost/compute budget;
- tool permissions;
- stop conditions;
- review/approval policy;
- auditability.

Employees may think broadly, research, analyze, and propose freely inside policy. Execution authority is narrower and must be explicitly granted.

---

## B1 — Proactive work initiation
**APPROVED WITH REVISED BOUNDARY**

Employees may proactively:
- detect opportunities;
- detect risks/problems;
- open proposals or work candidates;
- research;
- analyze;
- prepare recommendations;
- begin only the execution steps already permitted by their authority/policy.

If the next step exceeds authority, cost budget, or risk boundary, the employee must raise a Decision / Approval request rather than silently proceeding.

---

## B2 — Director work creation and delegation
**APPROVED WITH REVISED BOUNDARY**

Department directors may decompose approved goals, create tasks, and assign work within their departments without Founder approval for every task, provided that:
- the work remains inside approved company/department goals;
- the director has authority for that work type;
- budget and compute limits are available;
- required reviews/approvals are preserved;
- no permanent authority expansion is created.

---

## B3 — Organizational change proposals
**APPROVED**

Employees and directors may propose:
- a new permanent role;
- retiring a role;
- moving a role between departments;
- creating/removing a department;
- changing reporting lines;
- expanding required capabilities.

They may research and justify the proposal, including expected benefit, cost, risk, and alternatives.

They may **not execute permanent organizational changes unilaterally in Strong v1**.

Founder approval is the default for permanent structural changes.

---

## B4 — Temporary task agents
**APPROVED WITH STRONGER BOUNDARY**

The system/directors may create temporary task agents only from approved capabilities and under explicit policy.

Temporary agents:
- are scoped to a defined task/outcome;
- receive a hard compute/token/cost budget;
- receive bounded tools and permissions;
- have a maximum lifetime / stop condition;
- cannot create persistent employees;
- cannot escalate their own authority or budget;
- cannot recursively spawn unbounded agents;
- must terminate or return control when the task ends, budget is exhausted, or stop conditions trigger.

---

## B5 — Persistent employee creation
**APPROVED**

Directors may propose a persistent employee or permanent role.

They may not create one unilaterally in Strong v1.

Founder approval is the default requirement for:
- new persistent employees;
- permanent roles;
- permanent reporting-line changes;
- permanent authority changes.

---

## B6 — Financial and compute autonomy
**APPROVED**

Two distinct budgets exist:

### A. AI / compute operating budget
Examples:
- model tokens;
- search/tool usage;
- approved AI services.

Employees/directors may consume this only inside pre-approved limits.

Budgets must exist at multiple levels:
- company;
- department;
- employee;
- task;
- run/session;
- delegation/sub-agent;
- communication where applicable.

Hard limits must be enforceable by the runtime.

### B. External financial commitments
Examples:
- buying a service;
- starting a paid subscription;
- advertising spend;
- paying a supplier;
- signing a paid contract.

These require Founder approval by default in Strong v1 unless a later explicit policy delegates a narrow, capped category.

No employee or director may increase its own budget.

---

## B7 — External publishing / public actions
**APPROVED**

Employees may autonomously:
- research;
- generate campaign concepts;
- prepare copy;
- prepare creatives;
- prepare SEO/content plans;
- simulate/preview publishing;
- recommend experiments.

Public actions under the QANDEEL name require approval by default in Strong v1, including:
- publishing posts/pages/campaigns;
- external communications representing QANDEEL;
- changes that materially affect public brand/positioning.

Later, specific trusted workflows may receive pre-approved publishing authority for tightly defined low-risk actions.

---

## B8 — Product and engineering autonomy
**APPROVED**

Employees may autonomously:
- inspect repositories;
- read code;
- diagnose bugs;
- research technical options;
- analyze incidents;
- write implementation plans;
- propose patches;
- create technical recommendations.

**Code modification is not open-ended autonomy in Strong v1.**

Writing code requires:
- an approved/authorized Work Item;
- a defined scope;
- a bounded branch/workspace;
- a compute budget;
- required tests/evidence;
- review rules.

The author does not approve its own important work.

By default:
- no self-authorized merge;
- no direct production mutation;
- no strategic product behavior change without appropriate approval;
- no bypass of CI/review gates.

Low-risk engineering autonomy may be expanded later only after demonstrated reliability and explicit policy.

---

## B9 — Sovereign Founder-only decisions
**APPROVED**

Founder approval remains mandatory by default in Strong v1 for:
- changing company constitution/governance;
- changing Founder authority;
- permanent organizational structure changes;
- major pricing/business-model changes;
- entry into a new market/country at strategic level;
- major brand/positioning changes;
- legal commitments/signatures;
- material external financial commitments;
- granting new sensitive credentials;
- expanding high-risk permissions;
- sensitive data-sharing decisions;
- destructive production actions unless explicitly pre-authorized by a reviewed policy;
- strategic product pivots / core product promise changes.

Detailed risk classes are deferred to Stage 3.

---

## B10 — Secrets, permissions, and self-escalation
**APPROVED**

Employees and directors may request:
- additional tools;
- additional credentials;
- higher budget;
- wider permissions;
- broader authority.

They may not grant these to themselves.

Default rule:

> No self-escalation of authority, credentials, budget, reviewer independence, merge authority, or destructive-action permission.

---

## B11 — Learning and self-improvement
**APPROVED**

Employees are expected to learn from outcomes and mistakes.

They may:
- record observations;
- propose lessons;
- update personal working heuristics where allowed;
- propose changes to SOPs/training;
- request retraining;
- suggest safer or more effective workflows.

They may not unilaterally:
- change their Role Constitution;
- expand their authority;
- convert a personal lesson into Canonical Company Truth;
- weaken safety/review rules;
- promote themselves to a higher trust/autonomy tier.

Learning must pass the appropriate validation path before it becomes institutional policy.

---

## B12 — Token / compute runaway prevention
**APPROVED**

QANDEEL Company OS must prevent runaway AI usage technically, not by prompt instruction alone.

Strong v1 must include:
- hard token/cost ceilings;
- per-run limits;
- per-task limits;
- per-employee limits;
- per-department limits;
- company-wide limits;
- concurrency limits;
- recursive delegation limits;
- communication-loop limits;
- idle/stagnation detection;
- duplicate-work detection;
- automatic stop on exhausted budget;
- explicit request path for more budget;
- audit of model/tool consumption.

Budget exhaustion must stop or safely pause work. It must never silently trigger unlimited fallback spend.

---

## B13 — Agent-to-agent communication cost controls
**APPROVED**

Agent communication must be structured and outcome-bound.

Default communication types:
ASK / REQUEST / HANDOFF / REVIEW / CHALLENGE / ESCALATE / DECISION / FYI.

The system should avoid free-form perpetual agent conversations.

Where possible:
- machine state changes use database/events without LLM calls;
- an LLM is invoked only when interpretation, reasoning, synthesis, creativity, or negotiation is actually needed;
- requests have closure conditions;
- unanswered/looping threads have limits;
- agents cannot recursively keep each other awake without bounded work justification.

---

## B14 — Event-driven execution over noisy heartbeats
**APPROVED**

Default employee activation should be event-driven:
- assignment;
- incoming answer;
- scheduled report;
- metric trigger;
- explicit wake;
- approved monitoring event.

Periodic heartbeats should only exist when the function genuinely requires them and should have explicit cadence/budget.

Idle polling must not consume open-ended model tokens.

---

## B15 — Autonomy maturity / earned trust
**APPROVED**

Autonomy is not binary.

Candidate lifecycle:

Training  
→ Shadow  
→ Supervised  
→ Scoped Autonomous  
→ Expanded Scoped Autonomous

Promotion requires evidence of reliability, quality, policy compliance, cost discipline, and learning.

Repeated failure may reduce autonomy and trigger retraining.

Exact tiers and promotion rules are deferred to later stages.

---

# 5. Decision Set C — Pre-launch operating scope

### C1 — Which departments must exist before public launch?
PARTIALLY APPROVED — initial pre-launch core team direction accepted; exact full department set remains open.

### C2 — Which employees should be the first training cohort?
**APPROVED INITIAL COHORT:**
- Growth Director
- Strategic Market Intelligence Director
- SEO Lead
- Content / Creative Strategist

**Strategic Market Intelligence Director — approved role direction**
- global strategic intelligence capability;
- strong Egypt, Saudi, and broader Arab-market expertise;
- not country-bound;
- directly useful to Founder as a strategic thinking partner;
- able to reinterpret/refine raw founder ideas;
- expected to challenge assumptions and surface non-obvious market insights;
- remains the same senior role when QANDEEL enters new markets;
- new markets add market-specific intelligence layers and/or temporary local specialists rather than replacing the director.

### C3 — Should Product/Engineering employees also join pre-launch training?
Open.

### C4 — How long should shadow/probation behavior be demonstrated before Active Duty?
Open; do not choose duration arbitrarily before defining evidence.

---

# 6. Decision Set D — Company interfaces

### D1 — Founder interface
**APPROVED**

Strong v1 will provide a **Windows Desktop Application** as the Founder-facing headquarters for QANDEEL COMPANY.

From this application, Mohamed should be able to see and control the company, including departments, employees, work, approvals, budgets, costs, reports, risks, messages, memory/role/authority views, and relevant integrations.

### D2 — Employee interface
**APPROVED DIRECTION**

Employees run through the local company runtime in the background, while the Windows app exposes inspectable employee pages and conversations so Founder can interact with any Director or Employee directly when needed.

### D3 — External system boundary
Candidate integrations:
- Git/GitHub
- analytics
- search/SEO data
- website/app metrics
- business tools later

Exact Strong v1 list remains open.

---

# 7. Decision Set E — Strong v1 explicit exclusions

Candidates for exclusion unless Founder decides otherwise:

- autonomous legal signatures
- unrestricted financial transfers
- autonomous hiring/firing of humans
- unrestricted production-destructive actions
- fully cloud-distributed 24/7 architecture
- large marketplace of generic employees
- multi-company SaaS productization
- customer-facing autonomous support without explicit approval

Not yet approved.

---


## Model / Provider Boundary — APPROVED

QANDEEL Company OS is **model- and provider-agnostic**.

- Employee identity, memory, authority, work state, and learning must not belong to a model provider or chat session.
- Qwen and DeepSeek are initial cost-focused candidates for evaluation, not permanent architectural dependencies.
- Different models may be selected by task based on measured quality, cost, latency, context requirements, and privacy.
- Tasks that can be executed deterministically without an LLM should not consume LLM tokens.
- Final model-routing decisions are deferred to benchmark-driven runtime design.

---

# 8. Gate A0 closure test

A0 may close only when we have an approved answer for:

1. One-paragraph product definition.
2. Primary user/operator.
3. Company scope.
4. Founder operating model.
5. Strong v1 in-scope.
6. Explicit out-of-scope.
7. Autonomy boundary.
8. Pre-launch use case.
9. Key constraints.
10. Strong v1 success test.
11. Open research questions carried forward.

---

# 9. Final Stage 0 Status

**0.1 Product Statement:** APPROVED  
**0.2 Founder Operating Model:** APPROVED  
**0.3 Strong v1 In-Scope:** APPROVED  
**0.4 Explicit Out-of-Scope:** APPROVED  
**0.5 Constraints:** APPROVED  
**0.6 Success Definition:** APPROVED  
**0.7 Research Questions Register:** APPROVED / CARRIED FORWARD  

**Gate A0:** PASSED  
**Stage 0:** CLOSED / ACCEPTED

## Final Product Boundary

QANDEEL Company OS is a QANDEEL-specific, Windows-first, local-first company operating system for Mohamed as Founder to manage the full QANDEEL business through persistent, trained AI employees and department directors.

The system is model/provider-agnostic, keeps company identity and state independent from sessions/providers, uses bounded and earned autonomy, enforces hard compute/cost limits, supports structured collaboration and learning, and remains under Founder control for sovereign and high-risk decisions.

Strong v1 is not a generic SaaS platform, not a fully cloud-distributed 24/7 company, and not an autonomous legal/financial actor.

## Pre-launch Core Team — APPROVED

Initial training cohort:
- Growth Director
- Strategic Market Intelligence Director
- SEO Lead
- Content / Creative Strategist
- Product Intelligence

Additional pre-launch role:
- Brand / Creative Director

Engineering / Release Intelligence enters after the first successful employee-system pilot.

Finance / Legal / Operations remain callable capabilities rather than permanent departments at this stage.

Customer Intelligence / Support enters nearer Beta/Launch when real user feedback exists.

## Strategic Market Intelligence Director — APPROVED

This is a global strategic intelligence role, not an Egypt-only market researcher.

The role must:
- understand Mohamed's raw ideas and help reformulate them strategically;
- challenge assumptions and produce non-obvious insight;
- think globally;
- have strong Egypt, Saudi, and wider Arab-market competence;
- expand into new markets using market intelligence layers and temporary/local specialists rather than being replaced.

## Founder Interface — APPROVED

Strong v1 will provide a Windows desktop application as Mohamed's primary company interface.

From it, the Founder should be able to see and control company state, departments, employees, work, approvals, budgets, costs, communications, reports, risks, and outcomes.

External systems such as GitHub, analytics, search/SEO data sources, and model providers are integrations—not the headquarters of the company.

## Stage 0 Research Register — CARRIED FORWARD

Research must continue during later stages on:
1. Persistent employee identity independent of model/session.
2. Memory vs canonical truth vs learning architecture.
3. Structured agent-to-agent communication without runaway loops.
4. Hard token/cost/concurrency/delegation controls.
5. Local-first Windows runtime, portability, backup, and recovery.
6. Employee training, simulation, certification, and retraining.
7. Authority, permissions, secrets, and approval gates.
8. Benchmark-driven model routing across Qwen, DeepSeek, and future providers.
9. Event-driven execution rather than wasteful polling.
10. Performance evaluation based on outcome, reliability, learning, and cost discipline.
11. Ongoing review of relevant open-source/company-agent systems and their real failure modes before major architecture decisions.
