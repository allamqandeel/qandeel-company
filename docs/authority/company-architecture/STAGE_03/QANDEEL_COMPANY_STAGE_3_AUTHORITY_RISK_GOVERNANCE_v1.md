# QANDEEL COMPANY — STAGE 3
## Authority / Risk / Governance — Canonical Closure v1

**Status:** CLOSED / ACCEPTED  
**Gate:** A3 — PASSED  
**Date:** 2026-09-26  
**Weight:** 5% of Strong v1

# 1. Permission Model

- Role titles do not directly grant authority.
- Roles may provide permission templates, but effective authority comes from explicit grants/policies.
- Default posture is Deny unless an action/tool/data scope is explicitly allowed.
- Membership in a department does not automatically grant all department permissions.
- No employee or director may self-escalate authority, budget, credentials, reviewer independence, merge authority, or destructive-action permission.

# 2. Risk Ladder

R0 — Read/Analyze only.  
R1 — Low-risk, internal, reversible action.  
R2 — Important action requiring independent review, but not Founder approval.  
R3 — Sensitive/external/financial/production-impacting action. During the initial Strong v1 trust-building period, R3 requires Founder approval.  
R4 — Founder-only sovereign action.

The detailed mapping of actions to levels is policy-driven and may evolve without changing the constitutional principles.

# 3. Founder Trust-Building for R3

During initial operation:
- R3 actions require Mohamed’s approval.
- The requesting director/employee must explain the decision in Founder-friendly language:
  - what is happening;
  - why it matters;
  - recommendation;
  - risk;
  - decision required.
- Founder decisions and rationale become training/learning evidence.
- Over time, specific categories of R3 may receive delegated/standing approval after demonstrated reliability.
- Delegation must remain scoped, capped, time-bounded/revocable, and auditable.
- R4 remains Founder-only in Strong v1.

# 4. Maker / Reviewer Separation

- The creator of important work cannot be the sole approver of that work.
- R2 and above require review appropriate to risk.
- Review independence must be preserved by enforced authority, not prompt convention.

# 5. Approval Semantics

- Approvals are scoped to a specific actor/action/context.
- Approval scope may include limits such as budget, duration, data, tool, environment, and action arguments.
- Expired or out-of-scope approval cannot authorize a different action.
- Where action arguments materially change, prior approval is not reusable unless policy explicitly allows it.
- Approval and rejection outcomes must be durable across restarts.
- A rejected request must not silently regenerate as a fresh approval loop without a meaningful state change or explicit re-request.

# 6. Budget / Token / Cost Governance

QANDEEL tracks both tokens and monetary cost.

Budgets are hierarchical:
Company → Department → Employee → Task → Run

Additional limits apply where needed to:
- delegation/sub-agents;
- communication;
- concurrency;
- queue/wake behavior.

Rules:
- Hard stops are enforced by runtime, not prompts.
- Budget exhaustion safely pauses/stops work.
- Managers may allocate within an approved departmental budget.
- Increasing a total department/company cap requires Founder approval initially.
- No employee/director can increase its own budget.
- Expensive model fallback is forbidden unless an explicit policy/budget rule allows it.
- Token limits remain meaningful even where apparent provider dollar cost is low or subscription-based.
- Cost/token usage is auditable per provider, model, employee, task, and run where technically available.

# 7. Runaway Prevention

Runtime safety must include:
- concurrency caps;
- queue limits;
- wake deduplication;
- duplicate-work detection;
- loop/stagnation detection;
- idle skip;
- recursive delegation limits;
- communication-loop limits;
- safe pause on abnormal behavior.

Event-driven activation is the default over wasteful idle polling.

# 8. Credentials & Secrets

- Least privilege / need-to-know is mandatory.
- Credentials are not stored in employee memory or ordinary employee files.
- Secrets belong in a secure secrets mechanism/vault.
- Access may be issued only when needed.
- Temporary permissions expire automatically.
- Sensitive actions should use just-in-time access where practical.
- Revocation must be immediate and enforceable.

# 9. Incidents / Violations / Auto-Stop

Auto-pause is allowed/required for safety conditions including:
- authority bypass attempts;
- abnormal repeated actions;
- runaway loops;
- sensitive action attempts without required approval;
- serious policy violations.

Ordinary task failure does not automatically pause the entire employee.

Repeated validated violations may reduce autonomy:
Scoped Autonomous → Supervised → Retraining

Important incidents must surface to the Founder in plain language, including:
- what happened;
- what the system blocked;
- whether harm occurred;
- recommended response.

# 10. Governance Execution Principle

Governance must be enforced at actual action/tool boundaries.

Policies may:
- allow;
- deny;
- require approval;
- rate limit;
- constrain scope;
- expire;
- pause execution.

No prompt instruction can substitute for enforced runtime controls.

# 11. Gate A3 Closure

A3 is satisfied because Strong v1 now has an accepted governance contract for:
- explicit authority grants;
- default deny;
- risk levels;
- R3 Founder trust-building;
- R4 Founder sovereignty;
- independent review;
- scoped durable approvals;
- budget/token hard stops;
- runaway prevention;
- least-privilege credentials;
- incident auto-pause;
- autonomy reduction/retraining;
- tool-boundary enforcement.

**Gate A3 — PASSED**  
**Stage 3 — CLOSED / ACCEPTED**
