# QANDEEL COMPANY — STAGE 2
## Company Ontology & Canonical State — Canonical Closure v1

**Status:** CLOSED / ACCEPTED  
**Gate:** A2 — PASSED  
**Date:** 2026-09-26  
**Weight:** 6% of Strong v1

# 1. Core Company Ontology

The canonical company ontology is organized into eight domains:

1. Organization
   - Company
   - Department
   - Role
   - Position / Seat
   - Employee

2. Direction
   - Mission
   - Goal
   - Initiative
   - Project

3. Work
   - Work Item
   - Assignment
   - Dependency
   - Outcome

4. Authority
   - Constitution
   - Policy
   - Permission
   - Approval
   - Budget

5. Truth & Knowledge
   - Canonical Fact
   - Decision
   - Knowledge
   - Evidence

6. Employee Mind
   - Memory
   - Learning
   - Skill
   - Training
   - Certification

7. Collaboration
   - Message
   - Request
   - Handoff
   - Review
   - Escalation

8. Observation & Health
   - Metric
   - Report
   - Risk
   - Incident
   - Audit Event

# 2. Organization Model

Canonical hierarchy:
Company → Department → Role → Position → Employee

Rules:
- Role is independent from Employee.
- Position/Seat represents an actual place in the org structure.
- Each persistent Employee occupies one primary Position in Strong v1.
- Each Position has one accountable Manager by default.
- Dual reporting is not the default.
- Employees may collaborate outside their department without changing their primary Position.
- Capabilities are not equivalent to Roles.
- Department membership does not automatically grant all department authority.
- Temporary Task Agents are not Employees and do not enter the persistent org chart.
- Departments are relatively stable; temporary project teams may be created freely without constantly rewriting the org chart.

# 3. Direction Model

- The Founder owns the company Mission.
- Employees and directors may propose Mission changes; only the Founder can approve them.
- Company-level strategic Goals require Founder approval.
- Directors may derive Department Goals from approved company Goals within authority and budget.
- Important work should connect to an approved Goal or Standing Responsibility.
- Routine maintenance does not require artificial strategic Goals.

# 4. Work Model

- Every Work Item has one accountable Owner.
- Multiple contributors may participate, but accountability remains singular.
- Employees may challenge or escalate work that is unsafe, unclear, outside authority, or missing context.
- Employees may open work for themselves when they detect a relevant opportunity/problem within their responsibility.
- Managers may reprioritize or stop such work.
- Task completion and Outcome achievement are separate states.
- The system must preserve dependencies, blocked/waiting states, handoffs, reviews, and closure evidence.

# 5. Canonical Truth / Decision / Knowledge / Memory

These are distinct entities and may not be conflated.

Authority ordering:
Constitution
→ Approved Policy
→ Canonical Decision
→ Verified Data / Canonical Fact
→ Institutional Knowledge
→ Employee Memory / Opinion

Rules:
- Memory is never automatically canonical truth.
- Important Decisions retain their history, source, author, date, rationale, and evidence.
- New decisions supersede old decisions; old decisions remain traceable.
- Employee learning stays personal until validated.
- Validated lessons may become Institutional Knowledge, SOP, Training, or Policy depending on authority.
- Conflicting canonical sources must be escalated rather than arbitrarily chosen.
- Stale knowledge must be detectable.

# 6. Collaboration, Evidence & Audit

- Founder can inspect employee communication on demand, but the default experience surfaces only what matters.
- Managers may inspect work-related communication in their scope, subject to restricted-data boundaries.
- Institutional work history is not deletable by the employee who created it.
- Corrections and supersession are allowed; erasure is not the default.
- Evidence retention should be sufficient to explain and verify important outcomes and decisions without preserving every transient token forever.
- Important evidence includes outputs, sources, approvals, tests, costs, and decisions.
- Scratch reasoning and transient data may have shorter retention.
- Founder Communication Standard applies to all employee communication with Mohamed:
  1. What is happening?
  2. Why does it matter?
  3. What do I recommend?
  4. Do I need a decision from you?
- Technical detail remains available on demand but is not the default communication style.

# 7. Observation & Health

- Each Department has a health state derived from evidence/metrics, not only manager opinion.
- Employees may independently raise Risks or Incidents.
- Important Metrics must have an owner and connect to a Goal or Standing Responsibility.
- Founder Command Center surfaces only meaningful changes, risks, opportunities, stalled goals, abnormal budgets, incidents, and Founder decisions required.

# 8. Stable Identity and State History

- Every important entity receives a stable internal ID.
- Names, labels, roles, departments, and other mutable attributes may change without changing identity.
- Employee ≠ Session ≠ Model Run.
- Session/model failure does not change canonical employee identity.
- State transitions are historically traceable.
- Repeated retries must not duplicate canonical actions; implementation must later support idempotent execution where relevant.
- Archive/Retire/Cancel is the default alternative to destructive deletion.
- Legal/privacy deletion remains a separate controlled policy.

# 9. Source-of-Truth Principle

Each major company object class must have one authoritative source-of-truth definition.

The authoritative source may differ by data type:
- Git/versioned files for constitutional and durable human-reviewed artifacts.
- Operational database for live work, messages, states, metrics, and runtime activity.
- External systems may provide verified source data but do not become governing authority by default.

Detailed physical storage mapping is deferred to runtime architecture stages.

# 10. Gate A2 Closure Test

A2 is satisfied because QANDEEL Company now has an accepted ontology and canonical-state contract covering:
- company entities;
- relationships;
- identity stability;
- decision history;
- canonical truth precedence;
- memory separation;
- work ownership;
- collaboration/evidence;
- metrics/risks/incidents;
- archival/history;
- source-of-truth principle.

**Gate A2 — PASSED**  
**Stage 2 — CLOSED / ACCEPTED**
