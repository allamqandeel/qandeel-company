# QANDEEL COMPANY — STAGE 7
## Skills / Tools / Capability System — Canonical Closure v1

**Status:** CLOSED / ACCEPTED  
**Gate:** B7 — PASSED (design contract)  
**Date:** 2026-09-26  
**Weight:** 5% of Strong v1

# 1. Core Principle — Every Employee Has a Living Skill Profile

No employee, including Directors, is treated as a static prompt or a fixed persona.

Every persistent employee has:
- a Role Skill Blueprint;
- an Employee Skill Passport;
- proficiency levels;
- certification/evaluation evidence;
- update/freshness state;
- versioned skill dependencies;
- identified skill gaps;
- continuous skill-development history.

Skill identity belongs to QANDEEL Company and the employee profile, not to a specific LLM provider or model.

# 2. Role Skill Blueprint

Every Role has an explicit Mandatory Skill Blueprint.

The Blueprint defines:
- required skills;
- minimum proficiency;
- critical skills;
- optional/advanced skills;
- management skills when applicable;
- required market/domain capabilities;
- required operating/company skills.

A Director is not merely a stronger specialist.

Director roles must include management capabilities such as:
- Delegation;
- Prioritization;
- Coaching;
- Review;
- Conflict Resolution;
- Goal Decomposition;
- Strategic Synthesis;
- Budget Judgment;
- Founder Communication;
- Team Development.

# 3. Employee Skill Passport

Each employee maintains a durable Skill Passport.

Each skill record should support:
- Skill ID;
- Skill Name;
- Version;
- Proficiency;
- Certification status;
- Last Tested;
- Last Updated;
- Evaluation evidence;
- Freshness state;
- Source/provenance;
- Restrictions/dependencies;
- Training state.

Example proficiency ladder:
- Learning
- Qualified
- Proficient
- Expert

Exact numeric scoring may be introduced later without changing this contract.

# 4. QANDEEL Skill Registry

Skills are centrally registered rather than copied independently into each employee.

The Skill Registry holds:
- canonical Skill identity;
- version;
- source;
- owner;
- license;
- compatibility;
- allowed/requested tools;
- dependencies;
- security status;
- benchmark results;
- freshness;
- affected Roles/Employees;
- rollback target;
- lifecycle status.

Employees reference approved skill versions through their Skill Passports.

# 5. Progressive Skill Loading

Employees may possess many approved skills, but only task-relevant skills should be loaded into active context.

Canonical pattern:

Discover available capability metadata
→ Match task requirements
→ Load selected skill instructions/resources
→ Execute only with authorized tools

This minimizes token/context cost and reduces irrelevant instruction interference.

# 6. Additional Skills Beyond the Role

Employees may acquire useful skills outside their mandatory Role Blueprint.

Additional skills:
- do not change Role automatically;
- do not grant new authority automatically;
- do not grant Tool access automatically;
- may improve routing eligibility only where authority and certification permit.

# 7. Skill Discovery Sources

Skill gaps and new skills may be discovered by:
- the employee during work;
- a manager;
- Academy/evaluation results;
- repeated failure analysis;
- QANDEEL Continuous Skill Intelligence;
- external professional developments;
- new company operating needs.

An employee may propose a missing skill but cannot self-authorize its installation or authority expansion.

# 8. Skill Types

QANDEEL recognizes at least:

1. External Skill
   - obtained from an external source.

2. Adapted Skill
   - external/open material modified for QANDEEL use.

3. QANDEEL-native Skill
   - built from QANDEEL's validated operating knowledge, recurring workflows, outcomes, and lessons.

Repeated high-value QANDEEL practices should progressively become QANDEEL-native Skills where useful.

# 9. Free-Only Capability Ecosystem

Canonical Founder requirement:

**QANDEEL COMPANY does not purchase Skills, Skill Packs, capability libraries, reusable capability templates, or equivalent capability assets.**

Accepted sources must be:
- legally free to use; and preferably
- open source with a clear license.

Not accepted as the default capability source:
- paid Skill marketplaces;
- paid proprietary Skill packs;
- time-limited free trials;
- unclear/unlicensed repositories;
- assets whose reuse rights cannot be verified.

A Skill being publicly visible does not establish a legal right to use, modify, or redistribute it.

# 10. Paid Dependency Detection

Every Skill must declare or discover material dependencies.

If a free Skill requires a paid dependency, it is labeled:

`FREE SKILL — PAID DEPENDENCY`

Such a dependency must not be silently treated as part of the free Skill ecosystem.

Tool/service spending decisions remain subject to QANDEEL budget and authority policy; the Skill system itself may not hide or normalize paid capability acquisition.

# 11. Skill Sourcing Priority

Preferred order:

1. Trusted open-source / official free source
2. Other legally free licensed source
3. Adapt/Fork if license permits
4. Build QANDEEL-native Skill

Popularity alone is not evidence of quality, safety, or legal suitability.

# 12. Provenance & License

Every approved Skill must have traceable provenance, including where relevant:
- source;
- author/organization;
- license;
- version/revision;
- acquisition date;
- security review;
- last benchmark;
- internal owner.

No clear license / permission for required usage → reject from production use.

# 13. Vendor / Model Neutrality

Skills should use a vendor-neutral representation where practical.

A Skill must not become inseparable from one model/provider unless there is an explicit compatibility reason.

Employee capability remains persistent even when the selected model/provider changes.

# 14. Skill ≠ Tool

Skill = procedural capability / expertise.

Tool = executable system, API, connector, application, or action surface.

Having a Skill does not grant Tool access.

Having Tool access does not prove Skill competence.

# 15. Tool Access Contract

Tool access is constrained by:
- Role;
- Work Item;
- authority;
- risk level;
- permissions;
- certification where needed;
- current policy.

New tools require review before company-wide availability, especially when they:
- write data;
- publish externally;
- spend money;
- access secrets;
- change production;
- modify canonical systems.

Employees may propose tools but do not self-install/self-authorize them.

# 16. Capability Routing

Work Items define capability requirements such as:
- Required Skills;
- Minimum Proficiency;
- market/domain context;
- required Tools;
- Risk Level;
- budget;
- expected outcome.

Routing evaluates eligibility before ranking.

# 17. Eligibility Gate

An employee may only enter routing consideration when applicable conditions are satisfied, including:
- Active/eligible lifecycle state;
- required certification;
- required skill proficiency;
- required authority;
- required Tool access;
- workload/capacity;
- budget constraints;
- no blocking suspension/security state.

# 18. Best-Fit Routing

The system should select best fit rather than always selecting the strongest or most senior employee.

Selection may consider:
- skill match;
- proficiency;
- recent evals;
- market/context experience;
- relevant outcomes;
- workload;
- cost;
- availability.

Simple work should not automatically consume the most expensive runtime or most senior employee.

# 19. Small Complementary Teams

If one employee is insufficient, a small complementary team may be formed.

Rules:
- one accountable Owner;
- bounded Contributors;
- distinct capability contribution;
- avoid duplicated research/work;
- avoid uncontrolled agent swarms.

# 20. Capability Gap

If no employee satisfies the required capability level, do not silently assign the nearest available employee.

Create a Capability Gap that may trigger:
- training;
- new Skill;
- temporary Specialist;
- task decomposition;
- escalation;
- revised requirements.

# 21. Separation of Employee, Skill, Reasoning and Model

Execution selection follows conceptually:

Work Item
→ Employee / Team
→ Required Skills
→ Authorized Tools
→ Reasoning Level
→ Model / Provider

The same employee may use different models or reasoning depths for different work without losing identity.

# 22. Continuous Skill Intelligence Engine

QANDEEL maintains a centralized Continuous Skill Intelligence capability.

It watches relevant:
- official sources;
- open-source repositories;
- research;
- professional standards;
- domain methodologies;
- tool ecosystem changes;
- security advisories;
- company learning.

Employees do not each independently burn tokens re-researching the same updates by default.

# 23. Skill Freshness

Skills support freshness/lifecycle states such as:
- Current
- Review Due
- Update Available
- Deprecated
- Security Hold
- Retired

The system should identify affected Roles and Employees when a relevant Skill changes.

# 24. Update Pipeline

Skill changes do not automatically enter production.

Canonical path:

Discover
→ Inspect
→ License/Dependency Check
→ Security Review / Quarantine
→ Sandbox
→ Benchmark
→ Compare
→ Approve
→ Targeted Learning / Re-certification if required
→ Controlled Rollout

# 25. External Skill Quarantine

External Skills are treated as untrusted capability artifacts until validated.

They may contain:
- instructions;
- scripts;
- references;
- assets;
- executable behavior;
- tool expectations.

They must not gain production access merely because they come from GitHub or another public source.

# 26. Update Impact & Re-certification

Minor validated updates may be rolled out without full Academy retraining.

Material changes may require:
- Targeted Learning;
- targeted testing;
- partial recertification;
- full recertification if risk/behavior change is substantial.

# 27. Version Pinning

Production use must resolve to a known approved Skill version/revision.

Do not run floating/unreviewed latest versions by default.

Each approved version should be reproducible and traceable.

# 28. Rollback

Every material Skill update must have a rollback strategy.

If a new version:
- lowers quality;
- causes security problems;
- increases cost unexpectedly;
- breaks compatibility;
- changes behavior improperly;

the system can return affected employees/tasks to a previously approved Skill version.

# 29. Skill Conflict Handling

Multiple active Skills must not silently override company governance.

Precedence remains:

Constitution / Policy / Authority
> Canonical Company Decision
> Work Item constraints
> Approved Skill instructions

Conflicting Skill instructions should be detected/reviewed rather than arbitrarily combined.

# 30. Continuous Development Contract

Canonical rule:

**No QANDEEL employee is ever considered "finished learning."**

Every employee, including every Director:
- has a living Skill Profile;
- can develop new skills;
- can identify Skill Gaps;
- receives relevant validated updates;
- may require retraining/recertification;
- retains the same identity while capabilities evolve.

# 31. Gate B7 Closure

B7 is satisfied because Strong v1 now has an accepted Skills / Tools / Capability contract covering:
- mandatory Role Skill Blueprints;
- living Employee Skill Passports;
- central Skill Registry;
- progressive loading;
- External / Adapted / QANDEEL-native Skills;
- free-only capability sourcing;
- license/provenance/dependency controls;
- Skill/Tool separation;
- Tool access governance;
- capability routing;
- eligibility and best-fit selection;
- capability-gap handling;
- continuous Skill Intelligence;
- freshness;
- quarantine/testing;
- version pinning;
- rollback;
- conflict handling;
- continuous employee skill development.

**Gate B7 — PASSED (design contract)**  
**Stage 7 — CLOSED / ACCEPTED**
