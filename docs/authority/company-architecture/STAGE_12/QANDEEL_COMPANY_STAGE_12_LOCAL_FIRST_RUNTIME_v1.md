# QANDEEL COMPANY — STAGE 12
## Local-first Company Runtime — Canonical Closure v1

**Status:** CLOSED / ACCEPTED
**Gate:** D12 — PASSED (design contract)
**Date:** 2026-09-26
**Weight:** 5% of Strong v1

# 1. Windows App Is Not the Company Runtime

The Windows desktop application is the Founder-facing management interface.

The company runtime is a separate local background service/runtime.

Closing the visible UI must not destroy persistent company state or automatically terminate permitted background work.

# 2. Local-first, Single-Node Strong v1

Strong v1 is optimized for:
- one primary Windows machine;
- one Founder/operator;
- local-first persistence;
- simple, inspectable runtime architecture;
- future portability.

Do not introduce distributed infrastructure merely for architectural fashion.

# 3. SQLite / WAL Operational Store

Strong v1 uses a durable local SQLite database with WAL where appropriate for live operational state.

The data-access layer must avoid unnecessary coupling so a future migration to PostgreSQL or another datastore remains feasible.

SQLite is not treated as a reason to ignore concurrency, transaction, backup, or corruption concerns.

# 4. Durable Work Runs

Every meaningful Work Run is durable.

Important transitions are persisted before the runtime depends on them.

Examples:
- claim;
- checkpoint;
- model-call result;
- tool-call intent/result;
- approval wait;
- retry state;
- completion state.

Company continuity must not depend on process RAM or a live LLM session.

# 5. Event-driven Employees

Employee persistence does not mean a process is continuously running for each employee.

Employees are durable identity/state objects.

Workers are activated only by legitimate:
- Work Items;
- events;
- approvals;
- messages;
- dependencies;
- scheduled responsibilities.

Idle employees consume no LLM tokens merely to remain "alive".

# 6. Portable Company Workspace

The company workspace includes durable:
- Company DB;
- artifacts;
- knowledge;
- skills;
- policies;
- Academy material;
- configs;
- audit/log metadata;
- backups;
- exports.

Secrets are separated from ordinary portable workspace content and require secure recovery handling.

# 7. Environment Readiness Gate

No production/runtime implementation begins until the Environment Readiness Gate passes.

The gate checks at minimum:
- Windows version/configuration;
- PowerShell;
- Git;
- GitHub connectivity/permissions when required;
- selected runtimes (for example Node/Python/.NET if used);
- package managers;
- required CLI tools;
- plugins/connectors;
- permissions;
- service capability;
- local ports/IPC prerequisites;
- file paths and long-path behavior;
- certificates/security restrictions;
- SQLite/WAL behavior;
- file locking;
- backup/restore smoke test;
- background service start/stop/restart;
- provider/tool connectivity;
- dependency versions.

The result is a versioned Environment Manifest documenting:
- present components;
- missing components;
- installed/fixed components;
- approved versions;
- unresolved blockers.

Environment readiness is a hard execution prerequisite.

# 8. Employee != Process

Employee identity is independent from:
- OS process;
- worker;
- session;
- model run.

A company with many employees may operate with a small bounded worker pool.

# 9. Company Runtime Supervisor

A central local Runtime Supervisor is responsible for:
- service lifecycle;
- worker coordination;
- scheduling;
- health;
- restart/recovery coordination;
- controlled shutdown;
- queue admission.

The Supervisor does not act as an all-powerful AI employee.

# 10. Bounded Worker Pool

Workers are limited by explicit concurrency caps.

If more work exists than available worker capacity, work remains queued.

Strong v1 does not create one permanent process per employee.

# 11. Tool Execution Boundary

Reasoning and external side effects are separated.

AI workers may request actions.

Sensitive or state-changing actions pass through controlled Tool Executors that enforce:
- task scope;
- permissions;
- risk;
- approvals;
- policy;
- idempotency.

# 12. Worker Leases

Workers claim work using durable leases/claims.

If a worker dies or becomes unhealthy:
- the lease eventually expires;
- the Work Item becomes recoverable;
- another worker may resume from durable state.

Technical lease/health signals must not require LLM calls.

# 13. Runtime Failure Guards

Runtime implementation must support:
- timeouts;
- bounded retries;
- dead-letter state;
- circuit breakers;
- process health monitoring;
- poisoned-job handling.

One bad Work Item or worker must not take down the company.

# 14. Durable Queue

Strong v1 uses a durable queue represented in company operational state.

Queue entries carry stable identifiers and appropriate links to:
- Work Item;
- Owner;
- schedule/event;
- budget;
- risk;
- retry state;
- due time;
- lease/claim.

# 15. Event-driven First

Event-driven wake-up is preferred.

Examples:
- approval received;
- dependency resolved;
- Work Item created;
- response required;
- standing responsibility due;
- relevant external signal.

Scheduling is used when the responsibility is genuinely time-based.

# 16. At-least-once Delivery Assumption

Runtime delivery is designed under an at-least-once assumption.

Important jobs/actions use stable idempotency keys.

Duplicate delivery must not imply duplicate external side effects.

# 17. Scheduled Work Overlap Policy

Recurring work must define its overlap behavior, such as:
- skip;
- merge;
- queue after current;
- explicitly permit concurrency.

A recurring job does not automatically run a duplicate instance while an earlier instance is active.

# 18. Lightweight Wake-up

The scheduler/queue performs cheap deterministic admission checks before AI execution.

A wake-up event itself does not require an LLM call.

# 19. Queue Safety Metadata

Implementation should support:
- deduplication window;
- retry count;
- next-attempt time;
- lease expiry;
- dead-letter state;
- poison-job detection.

# 20. Runtime State in SQLite

Live operational state includes appropriate records for:
- employees;
- positions/lifecycle;
- Work Items;
- queues/jobs;
- runs;
- approvals;
- messages/requests;
- budgets;
- Skill references;
- review state;
- audit metadata;
- checkpoints;
- leases;
- retry state;
- runtime versions.

# 21. Artifact Store

Large/binary artifacts are stored outside SQLite in a structured local Artifact Store.

Examples:
- video;
- images;
- ZIPs;
- large reports;
- training artifacts;
- exports.

The DB stores durable identity, path/reference, hash, metadata, and ownership.

# 22. Git Scope

Git is used for durable, reviewable version-controlled artifacts such as:
- Constitution;
- policies;
- Skill definitions;
- Academy curriculum;
- workflow/rubric definitions;
- config schemas;
- canonical documents.

Git is not the storage engine for:
- queue state;
- live messages;
- token logs;
- leases;
- runtime checkpoints;
- rapidly changing operational state.

# 23. Secrets Boundary

Secrets are not stored in:
- ordinary SQLite fields;
- Git;
- ordinary Artifact folders;
- logs;
- employee memory.

Stage 14 defines the detailed secrets/security implementation.

# 24. Stable Workspace Layout

The workspace uses a stable portable structure conceptually including:

- runtime/
- artifacts/
- knowledge/
- skills/
- policies/
- academy/
- configs/
- logs/
- backups/
- exports/

Exact implementation may evolve while preserving the separation of concerns.

# 25. Persist Before Trust

An important state transition is not trusted merely because a process believes it happened.

Durable state is written before downstream logic relies on it.

# 26. Startup Recovery Pass

Runtime startup performs recovery before accepting normal new work.

Recovery inspects:
- orphaned In Progress work;
- expired leases;
- pending approvals;
- incomplete tool actions;
- pending retries;
- blocked work;
- due scheduled work;
- recovery metadata.

# 27. External Side-effect Reconciliation

If a crash occurs around a non-idempotent or externally observable action, the runtime reconciles external reality before retrying.

Examples:
- publication;
- merge;
- payment;
- external record creation;
- external API mutation.

Do not blindly repeat an uncertain side effect.

# 28. Graceful Shutdown

When possible:

Stop accepting new work
→ checkpoint active work
→ park/release claims
→ persist state
→ stop service.

The runtime must still tolerate hard crashes where graceful shutdown is impossible.

# 29. Startup Throttling

Recovery/startup does not wake every queued Work Item simultaneously.

Work resumes under bounded concurrency and priority rules to prevent restart wake storms.

# 30. Backup Is Application-consistent

Live database backups use an application-consistent snapshot/backup mechanism.

Do not copy active SQLite database files casually and assume consistency.

# 31. Layered Backup

Backup architecture distinguishes:
- DB snapshot;
- artifact manifest/changed artifacts;
- canonical Git/versioned content;
- config;
- audit/recovery manifest;
- secrets recovery package if explicitly designed and encrypted.

# 32. Backup Manifest

Every backup has a manifest containing appropriate information such as:
- Backup ID;
- time;
- runtime version;
- DB schema version;
- artifact hashes;
- Skill/config versions;
- integrity status.

# 33. Isolated Restore

Restore is validated before replacing the live company.

Canonical path:

Validate
→ Integrity Check
→ Restore to isolated workspace
→ Migration/compatibility check
→ Dry Start
→ Compare
→ Promote

# 34. Device Portability

A healthy QANDEEL COMPANY workspace can be restored onto a new compatible Windows machine without losing:
- employee identities;
- memory/knowledge;
- work state;
- Skill state;
- decisions;
- review history;
- audit state.

Secrets are re-established through secure recovery rather than assumed to exist in ordinary backups.

# 35. Restore Drills

Backup existence is not considered sufficient.

Periodic restore drills prove that backups remain usable.

# 36. Runtime Update Pipeline

Runtime updates follow:

Build
→ Test
→ Migration Check
→ Backup
→ Staging / Dry Run
→ Health Check
→ Activate.

Direct unvalidated mutation of the live runtime is not the default.

# 37. Versioned Database Migrations

DB schema migrations are explicit and versioned.

The runtime knows:
- current schema version;
- required target version;
- migration sequence;
- compatibility constraints.

# 38. Pre-update Snapshot

Important updates create an automatic pre-update recovery snapshot.

Rollback planning must consider both:
- application/runtime version;
- database/data migration state.

Not every DB migration is safely reversible through code rollback alone.

# 39. Controlled Maintenance State

Important runtime updates use a maintenance sequence:

Stop new work
→ checkpoint/park active runs
→ settle sensitive actions
→ backup
→ migrate/update
→ verify health
→ resume.

# 40. Feature Flags / Compatibility Gates

Large or risky features may be installed disabled.

They may be:
- enabled for limited scope;
- tested on selected employees/departments;
- observed;
- progressively expanded;
- disabled independently if unsafe.

# 41. Company Health Model

Runtime exposes an explicit health model including:
- Runtime;
- Workers;
- Queue;
- DB;
- Disk;
- Backups;
- Model Providers;
- Tool Executors;
- Token/Cost state;
- stuck work;
- errors;
- recovery state.

Founder-facing health may summarize status such as:
- Healthy;
- Degraded;
- Attention;
- Critical.

# 42. End-to-end Traceability

Runs are traceable across:
Work Item
→ Worker
→ model calls
→ tool calls
→ review
→ approval
→ outcome.

Stable correlation IDs connect logs, metrics, traces, messages, and work state.

# 43. Actionable Runtime Alerts

Alerts focus on meaningful operational conditions such as:
- stuck worker/job;
- abnormal queue growth;
- DB integrity issue;
- overdue/failed backup;
- runaway token usage;
- repeated job failure;
- critical disk pressure;
- provider outage;
- failed recovery.

Alerting uses Stage 9 deduplication and attention rules.

# 44. Deterministic Health Checks

Health checks are lightweight and deterministic.

Checking DB/queue/worker/backup/runtime/provider status does not require LLM reasoning.

# 45. Observability Self-health

The observability/telemetry pipeline itself is monitored.

Missing telemetry is not automatically interpreted as system health.

The design may use vendor-neutral OpenTelemetry-compatible instrumentation, but Strong v1 must not depend on a single experimental telemetry feature for core health detection.

# 46. Observability Retention and Redaction

Implementation includes:
- retention policy;
- log rotation;
- sensitive-data redaction;
- secret filtering;
- bounded local storage.

# 47. Local IPC by Default

The Windows App communicates with the local Company Runtime through a local-only IPC mechanism.

Do not expose a general LAN/network port by default.

Named pipes/local RPC or another suitable Windows-local IPC option may be selected during implementation.

# 48. IPC Access Control

Local IPC is not trusted merely because it is local.

If named pipes are used:
- apply restrictive ACLs;
- scope to the authorized user/service/session as appropriate;
- prevent unintended network access;
- validate caller identity.

# 49. Authenticated Runtime Requests

Every privileged request to the runtime is associated with an authenticated/authorized caller context.

"localhost" is not an authorization policy.

# 50. Least-privilege Runtime API

The runtime does not expose a generic "execute anything" interface.

Commands are explicit capabilities such as:
- create Work Item;
- approve request;
- pause employee;
- inspect health;
- manage allowed runtime operations.

Every command passes authorization checks.

# 51. Tool Executor Boundary

External mutation tools are isolated from unrestricted agent access.

Tool Executors enforce the action contract before side effects occur.

# 52. Minimal Local Attack Surface

Production defaults include:
- no unnecessary ports;
- no unnecessary debug endpoints;
- no secrets in logs;
- protected writable directories;
- least-privilege service identity;
- audited IPC/API actions;
- validation and command allowlists;
- anti-replay/rate-limiting protections where appropriate.

# 53. Gate D12 Closure

D12 is satisfied because Strong v1 now has an accepted Local-first Runtime contract covering:
- Windows UI/runtime separation;
- local SQLite/WAL operational persistence;
- durable workers and queue;
- event-driven wake-up;
- idempotency;
- structured data/artifact/Git/secrets separation;
- crash recovery/reconciliation;
- backup/restore/device portability;
- safe updates/migrations;
- observability and health;
- local IPC/security boundary;
- mandatory Environment Readiness Gate before implementation.

**Gate D12 — PASSED (design contract)**
**Stage 12 — CLOSED / ACCEPTED**
