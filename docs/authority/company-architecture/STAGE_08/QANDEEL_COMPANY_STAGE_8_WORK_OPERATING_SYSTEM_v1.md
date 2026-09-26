# QANDEEL COMPANY — STAGE 8
## Work Operating System — Canonical Closure v1

**Status:** CLOSED / ACCEPTED  
**Gate:** C8 — PASSED (design contract)  
**Date:** 2026-09-26  
**Weight:** 7% of Strong v1

# 1. Work Item as the Unit of Meaningful Work

Important company work is represented as an explicit Work Item.

A Work Item may carry:
- goal / intended outcome;
- accountable Owner;
- contributors;
- priority;
- deadline / timing constraints;
- required skills;
- budget;
- risk;
- dependencies;
- completion criteria;
- required evidence;
- review requirements;
- approval requirements;
- current state.

Ad-hoc invisible work must not be the primary operating model.

# 2. Task Completion Is Not Outcome Achievement

QANDEEL distinguishes:
- Work performed;
- Work completed;
- Work reviewed;
- Outcome verified.

A task can be executed correctly without achieving the desired business outcome.

The system must preserve this distinction for learning and reporting.

# 3. Work Item State Model

Canonical lifecycle supports states such as:

Proposed
→ Ready
→ Assigned
→ In Progress
→ Waiting / Blocked / Waiting Review / Waiting Approval
→ Completed
→ Reviewed
→ Outcome Verified
→ Closed

Additional terminal/transition states may include:
- Cancelled
- Superseded
- Failed

Exact implementation naming may evolve while preserving semantic distinctions.

# 4. Single Accountable Owner

Every important Work Item has one accountable Owner.

Contributors may assist, but accountability for the final result is not diffused.

Ownership transfer must be explicit.

# 5. Durable / Resumable Work

Long-running workflows must be resumable.

Progress and relevant pending state are checkpointed so that restart, crash, model/session reset, or local runtime interruption does not require restarting the work from zero.

Pending requests/approvals must remain linked to the Work Item across resume.

# 6. Proactive Work

Employees may create Work Items proactively within their role and authority.

Valid proactive triggers include:
- new signal;
- detected risk;
- goal gap;
- deadline;
- metric change;
- standing responsibility;
- manager/founder directive;
- resolved dependency.

Proactivity does not override authority, approvals, or budgets.

# 7. Proactive Work Boundaries

Creating a Work Item does not authorize sensitive execution.

Research, analysis, drafts, recommendations, and internal preparation may proceed within policy.

Publishing, spending, production changes, merges, sensitive external action, or other governed behavior remains subject to Stage 3 authority/approval rules.

# 8. Bounded Work Creation

Employees may create subtasks within bounded scope.

Uncontrolled recursive work creation is prohibited.

Material scope/budget expansion must return to management/approval as appropriate.

# 9. Director Proactive Responsibility

Directors have higher proactive responsibility for:
- monitoring goals;
- risks;
- backlog;
- team capacity;
- opportunities;
- dependencies;
- department performance.

They may create/assign work within their granted authority and budget, but may not expand their own authority or budget.

# 10. Priority Model

Priority should consider more than a label.

Factors may include:
- strategic importance;
- urgency;
- risk;
- dependency impact;
- expected value;
- deadline;
- cost;
- Founder directive.

# 11. Founder Priority Override

Founder priority may override internal ordering.

The system records resulting impact, including:
- delayed work;
- dependency changes;
- capacity impact;
- risk changes.

# 12. Work-in-Progress Limits

Employees and teams have WIP limits.

New work should enter a queue rather than automatically becoming In Progress.

This reduces:
- context switching;
- duplicate work;
- token burn;
- quality degradation.

# 13. Waiting / Blocked Efficiency

Blocked or waiting Work Items must not remain actively consuming runtime without reason.

They resume when a relevant event occurs.

Waiting is a state, not an instruction to keep polling continuously.

# 14. Event-Driven Reprioritization

Priority is reconsidered when meaningful events occur, such as:
- Founder directive;
- deadline change;
- dependency resolution;
- risk change;
- metric change;
- approval result.

Continuous high-frequency polling is not the default.

# 15. Explicit Dependencies

Important dependencies are explicit.

A Work Item records what it depends on and what other work depends on it.

# 16. Missing Dependencies

When a material dependency is missing, employees must not silently proceed as though it existed.

Allowed responses include:
- request dependency/input;
- use an explicitly permitted assumption;
- pause affected portion;
- escalate.

# 17. Blocked Ownership

A Blocked state records:
- reason;
- blocking dependency;
- person/system responsible for resolution;
- next unblock action.

# 18. Targeted Wake-Up

Dependency resolution wakes only affected Work Items.

Company-wide or broad unnecessary wake storms are prohibited.

# 19. Dependency Escalation

Delayed/unavailable dependencies escalate progressively:
Owner
→ Manager
→ Founder only when impact warrants Founder involvement.

# 20. Handoff Contract

A handoff transfers a bounded scope.

It should identify:
- requested work;
- inputs;
- deadline if relevant;
- required evidence;
- acceptance criteria;
- what remains with the original Owner.

# 21. Context-Minimal Handoff

The receiving employee gets only relevant:
- Work State;
- Knowledge;
- Decisions;
- Evidence;
- Context.

A handoff does not expose another employee's entire memory by default.

# 22. Duplicate Work Prevention

Before starting delegated/subtask work, the system checks whether:
- equivalent work is already in progress;
- equivalent work was recently completed;
- the output can be reused safely.

# 23. Handoff Acceptance

Receiver may:
- Accept;
- Ask Clarification;
- Reject with Reason;
- Escalate.

Unacknowledged handoffs must not disappear silently.

# 24. Ping-Pong / Cycle Prevention

The system detects:
- A ↔ B ping-pong;
- longer cycles such as A → B → C → A;
- repeated reassignments;
- stagnating handoffs.

Repeated cycles trigger Manager review.

# 25. Delegation Depth Limit

Delegation has bounded depth.

Subtasks may not recursively spawn unbounded chains.

Crossing the permitted depth requires review/escalation.

# 26. Fan-Out Limit

A Work Item may not create an uncontrolled number of parallel subtasks/agents.

Fan-out is bounded by:
- task type;
- budget;
- policy;
- risk.

# 27. Work Lineage

Every child/subtask/handoff is linked to a Root Work Item.

This lineage supports:
- duplicate detection;
- cycle detection;
- budget accounting;
- review;
- audit;
- cancellation;
- reporting.

# 28. Atomic Claim / Work Lock

A Work Item must support exclusive/atomic claim semantics when necessary.

If two workers wake simultaneously, only one may claim the same exclusive unit of work.

# 29. Delegation / Handoff Budget

Delegation chains carry bounded budgets.

A workflow bug or coordination loop must not be able to consume unbounded tokens/cost merely by creating additional delegated work.

# 30. Completion Criteria and Evidence

A Work Item cannot be considered successfully completed merely because an employee produced text/output.

Completion requires the defined completion criteria and appropriate evidence.

# 31. Completed vs Reviewed vs Outcome Verified

Canonical semantic distinction:

- Completed — executor finished required work.
- Reviewed — qualified reviewer/checks validated quality.
- Outcome Verified — intended real-world/result condition was verified where applicable.

These are not interchangeable.

# 32. Risk-Based Review

Review depth depends on risk.

Examples:
- low-risk work may use automated checks;
- important work may require peer/manager review;
- sensitive actions follow Stage 3 approval requirements.

# 33. Reviewer Independence

For important work, executor should not be the sole final reviewer of their own work.

Maker / final approver separation applies where risk warrants it.

# 34. Outcome Failure Is Preserved

If execution was competent but expected outcome was not achieved:
- execution may be recorded as completed/reviewed;
- outcome remains Not Achieved;
- evidence and learning are preserved.

Do not convert activity into success merely by closing the task.

# 35. Recurring Responsibilities

Recurring work is represented as explicit standing responsibilities rather than uncontrolled repeated task generation.

Each recurring responsibility has:
- owner;
- cadence/trigger;
- expected output;
- budget;
- review/retention policy.

# 36. Event-Driven / Lightweight Recurrence

Not every recurring responsibility should run a full agent workflow every time.

Prefer:
- event-driven checks;
- lightweight scheduled checks;
- escalation to full employee execution only when material work exists.

# 37. Recurring Work Budgets

Recurring responsibilities have bounded token/cost/time budgets.

They may not create unlimited background consumption.

# 38. No-Material-Change Result

A valid recurring-work result may be:

`NO MATERIAL CHANGE`

Employees are not required to generate long reports merely because a cadence fired.

# 39. Recurring Responsibility Review

Standing responsibilities are periodically reviewed.

They may be:
- adjusted;
- automated more cheaply;
- reduced in frequency;
- retired;

when evidence shows low value or unnecessary repetition.

# 40. Retry / Idempotency Contract

Retries must not blindly repeat external side effects.

Important actions require idempotent/replay-safe semantics where possible.

A retry should not accidentally:
- publish twice;
- charge twice;
- merge twice;
- create duplicate records;
- duplicate messages/actions.

# 41. Durable Checkpoints

Long workflows preserve durable checkpoints including relevant:
- executor/work state;
- messages/events required for resume;
- pending requests;
- pending approvals;
- dependency state.

Resume restores the logical Work Item state rather than relying on a live LLM session.

# 42. Cancellation and Supersession Propagation

When a Work Item is Cancelled or Superseded:
- active dependent branches are evaluated for cancellation;
- children must not continue blindly;
- retained independent work requires explicit policy/decision;
- cancellation is auditable.

# 43. Workflow Change Safety

Running Work Items must not silently break because workflow definitions changed.

Version/change compatibility must be considered for long-running workflows.

Implementation details belong to runtime design, but semantic continuity is required.

# 44. Gate C8 Closure

C8 is satisfied because Strong v1 now has an accepted Work Operating System contract covering:
- explicit Work Items;
- ownership;
- lifecycle/state;
- proactive work;
- priority/WIP;
- dependencies;
- bounded handoffs/delegation;
- duplicate/cycle/wake prevention;
- review/completion/outcome distinctions;
- recurring responsibilities;
- durable resume;
- retry/idempotency;
- cancellation/supersession propagation.

**Gate C8 — PASSED (design contract)**  
**Stage 8 — CLOSED / ACCEPTED**
