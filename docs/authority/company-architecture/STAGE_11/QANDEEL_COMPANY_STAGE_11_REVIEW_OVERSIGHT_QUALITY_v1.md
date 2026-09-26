# QANDEEL COMPANY — STAGE 11
## Review / Oversight / Quality — Canonical Closure v1

**Status:** CLOSED / ACCEPTED  
**Gate:** C11 — PASSED (design contract)  
**Date:** 2026-09-26  
**Weight:** 7% of Strong v1

# 1. Review Is Designed Before Execution

Important Work Items define their Review Plan before execution.

A Review Plan may specify:
- reviewer requirements;
- deterministic checks;
- evidence requirements;
- specialist review;
- manager review;
- approval requirements;
- outcome verification;
- escalation conditions.

Review is not an afterthought applied only when output already exists.

# 2. Risk-Based Review Layers

Review depth depends on risk and work type.

Illustrative pattern:
- Low risk → deterministic/automated checks where sufficient.
- Medium risk → automated checks + qualified peer/specialist.
- High risk → specialist + manager/authority review as required.
- Sensitive work → review plus Stage 3 Approval Gate.

Exact mappings may vary by Work Type and Policy.

# 3. Self-Check Is Not Final Review

Executors may perform self-checks.

For important work, the executor may not be the sole final reviewer of their own output.

Reviewer independence increases with risk.

# 4. Review the Process, Not Only the Output

Review may examine:
- final output;
- evidence and sources;
- tool selection/use;
- routing;
- handoffs;
- policy compliance;
- cost/token behavior;
- assumptions;
- intermediate state;
- quality of escalation;
- outcome logic.

A plausible final answer does not erase a flawed or unsafe process.

# 5. Failures Become Regression Evals

Material real-world failures become durable evaluation/test cases.

The system should use them to detect recurrence after:
- Skill changes;
- model/provider changes;
- prompt/instruction changes;
- workflow changes;
- tool changes;
- knowledge updates;
- policy updates.

# 6. Reviewer Model

Reviewers are selected by actual capability, not merely hierarchy.

Eligibility may consider:
- required Skill;
- reviewer certification;
- proficiency;
- work-type expertise;
- independence;
- availability;
- conflict status;
- recent reviewer quality.

# 7. Dynamic Review Pool

The Review Pool is a dynamic registry of qualified reviewers, not a separate standing department.

It may include:
- specialist employees;
- Leads;
- Directors;
- cross-skilled employees;
- appropriately qualified temporary specialists;
- automated/deterministic graders where suitable.

The system selects the best qualified reviewer for the specific review need.

# 8. Execute / Review / Approve Are Distinct

Employee capability records may distinguish:
- Can Execute
- Can Review
- Can Approve

Competence in execution does not automatically authorize review or approval.

# 9. Specialist vs Manager Review

Specialists primarily validate technical/domain accuracy.

Managers primarily validate:
- outcome alignment;
- priority;
- business judgment;
- integration;
- risk;
- department-level quality.

A Work Item may require both.

# 10. Two-Key Review

High-risk work may require two independent review keys, such as:
- qualified specialist review;
- manager/authority review.

Passing one review does not automatically satisfy both.

# 11. Reviewer Quality Is Evaluated

Reviewers are evaluated like other employees.

Signals may include:
- important errors missed;
- false approvals;
- false rejections;
- calibration;
- review latency;
- evidence quality;
- escalation quality;
- consistency;
- agreement with trusted reference judgments.

A weak reviewer may lose review eligibility pending retraining/recertification.

# 12. Review Pool Qualification

The Review Pool itself must prove that it is trustworthy for the work types it judges.

Reviewer admission requires appropriate:
- reviewer-specific training;
- certification;
- Gold Case testing;
- failure-case testing;
- calibration;
- domain competence.

The system must not treat a reviewer as trustworthy merely because they are senior.

# 13. Gold Cases and Calibration

Reviewers are tested against known/reference cases where reliable judgments are available.

Calibration should detect:
- over-approval;
- over-rejection;
- weak uncertainty handling;
- inconsistent standards;
- domain blind spots.

# 14. Shadow / Calibration Mode

A new or materially changed Review Pool / Reviewer / rubric begins in Shadow or Calibration Mode where appropriate.

It does not receive broad independent authority until evidence shows acceptable reliability.

Trusted human/Founder/Director or established reference decisions may be used to calibrate initial judgments.

# 15. Reviewer Uncertainty

Reviewers must be allowed to return:
- Uncertain;
- Insufficient Evidence;
- Needs Specialist;
- Escalate.

Guessing is not preferred to explicit uncertainty in critical work.

# 16. Review Reason + Evidence

Important Review decisions include:
- decision/result;
- rationale;
- supporting evidence;
- rubric/gate version;
- reviewer identity;
- uncertainty/escalation where relevant.

Review is not a bare PASS/FAIL without traceability.

# 17. Quality Gates

Important work types may define Quality Gates before they advance.

Gates may require:
- evidence completeness;
- test pass;
- compliance;
- review pass;
- approval;
- freshness;
- required confidence/evidence;
- outcome criteria.

# 18. No Silent Gate Override

Quality Gates cannot be silently bypassed.

Exceptional overrides require:
- explicit authorized actor;
- recorded reason;
- scope;
- risk acknowledgement;
- audit trail.

# 19. Quality Stop Rules

A Work Item may be stopped for reasons such as:
- failed tests;
- insufficient evidence;
- contradictory evidence;
- material reviewer disagreement;
- stale critical assumptions;
- policy/compliance failure;
- anomalous cost;
- critical low confidence;
- security concern;
- missing required approval.

# 20. Review Conflict

Important reviewer disagreement becomes an explicit Review Conflict.

Do not average away disagreement.

Resolve through:
- stronger/specialist reviewer;
- additional evidence;
- manager/authority review;
- escalation.

# 21. Quality Gate Evaluation

Quality Gates themselves are evaluated.

Track whether a Gate:
- correctly blocks bad work;
- incorrectly blocks good work;
- misses important failures;
- creates excessive friction;
- remains calibrated over time.

# 22. Quality Scorecards

No universal single quality score governs all work.

Relevant dimensions may include:
- Correctness;
- Evidence;
- Completeness;
- Policy Compliance;
- Cost Efficiency;
- Timeliness;
- Outcome Quality;
- Reliability;
- User/Founder usefulness.

# 23. Work-Type / Role Rubrics

Quality rubrics vary by Work Type and domain.

Examples:
- SEO audit;
- Brand concept;
- strategy analysis;
- code/release work;
- App Store readiness;
- market intelligence;
- product analysis.

A generic rubric must not replace domain-specific quality criteria.

# 24. Outcome Over Presentation

Polished presentation does not compensate for incorrect reasoning or poor outcomes.

A concise, accurate, useful output may outperform a visually elaborate but weak output.

# 25. Quality Trends

Quality is monitored over time.

Employee, Reviewer, Department, Skill, and workflow trends may show:
- improvement;
- recurring errors;
- drift;
- instability under pressure;
- regression after change.

# 26. Anti-Gaming

Metrics exist to understand and improve quality, not become the goal themselves.

When a metric incentivizes harmful gaming or misleading behavior, it must be revised, contextualized, or retired.

# 27. Independent Quality Oversight

QANDEEL maintains an Independent Quality Oversight capability.

It is organizationally independent from the specific work it audits.

It need not begin as a large permanent Department.

# 28. Oversight Sampling

Independent Oversight does not manually inspect everything.

It uses:
- risk-based sampling;
- anomaly triggers;
- repeated-failure triggers;
- random sampling;
- reviewer-quality signals;
- incident triggers;
- strategic/sensitive work selection.

# 29. Oversight Scope

Oversight may audit:
- Employee;
- Reviewer;
- Director;
- Skill;
- Model/provider behavior;
- workflow;
- routing;
- Quality Gate;
- Department;
- tool use;
- cost behavior;
- evidence practices.

# 30. Quality Hold

Independent Oversight may place a temporary Quality Hold on a capability/workflow/reviewer/Skill where evidence indicates material quality risk.

Quality Hold may trigger:
- investigation;
- rollback;
- retraining;
- recertification;
- additional review;
- regression testing.

Oversight does not independently expand its own authority or rewrite policy.

# 31. Corrective Action Loop

Important findings follow:

Finding
→ Root Cause
→ Corrective Action
→ Eval / Test
→ Verify Fix
→ Close

Repeated failures escalate rather than being repeatedly closed without systemic correction.

# 32. Oversight Quality Is Also Measured

Independent Oversight is not assumed infallible.

Track:
- useful findings;
- false alarms;
- missed systemic problems;
- audit precision;
- time to detection;
- corrective-action effectiveness.

# 33. Versioned Review System

Reviewers, rubrics, Quality Gates, evaluation datasets, and review configurations are versioned.

Material changes trigger appropriate regression evaluation before broad reliance.

# 34. Continuous Evaluation Triggers

Full or targeted evaluation should be triggered by material changes such as:
- model/provider change;
- major Skill update;
- significant knowledge update;
- new Tool/connector;
- workflow change;
- production incident;
- Quality Gate/rubric change.

# 35. Correlated Failure Protection

For high-risk work, review design should reduce correlated failures where practical.

Avoid pretending that two nominally independent reviewers are genuinely independent if they use effectively identical:
- models;
- prompts;
- evidence;
- assumptions;
- reasoning path.

High-risk review may deliberately diversify reviewer/model/evidence paths.

# 36. Review Pool Health Metrics

The Review Pool maintains health indicators such as:
- false approval rate;
- false rejection rate;
- reviewer agreement;
- calibration drift;
- escalation quality;
- coverage;
- review latency;
- uncertainty quality;
- regression detection.

No single metric is sufficient.

# 37. Trace-Level Quality Review

Where relevant, evaluation inspects end-to-end traces including:
- model calls;
- tool calls;
- guardrails;
- routing;
- handoffs;
- intermediate decisions;
- final result.

This allows quality failures to be attributed to the actual system component that failed.

# 38. Gate C11 Closure

C11 is satisfied because Strong v1 now has an accepted Review / Oversight / Quality contract covering:
- review plans;
- risk-based review layers;
- reviewer independence;
- dynamic qualified Review Pool;
- reviewer certification/calibration;
- shadow-mode trust building;
- uncertainty/escalation;
- Quality Gates and Stop Rules;
- work-type scorecards;
- anti-gaming;
- continuous/regression evals;
- independent oversight;
- corrective action;
- correlated-failure protection;
- trace-level evaluation;
- Review Pool health measurement.

**Gate C11 — PASSED (design contract)**  
**Stage 11 — CLOSED / ACCEPTED**
