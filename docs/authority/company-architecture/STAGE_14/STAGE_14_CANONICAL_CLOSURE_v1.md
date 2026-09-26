# QANDEEL COMPANY — Strong v1
## Stage 14 — Security / Permissions / Secrets
### Canonical Closure v1

**Status:** CLOSED / ACCEPTED  
**Gate:** D14 — PASS  
**Gate proof:** Compromised or hallucinating employee is constrained by enforced permissions.  
**Strong v1 progress after closure:** 81% CLOSED / 19% REMAINING  
**Previous canonical dependency:** QANDEEL_COMPANY_STAGE_13_CANONICAL_CLOSURE_v1.zip

---

## 1. Stage Purpose

Stage 14 defines the security boundary that constrains employees, agent runs, models, tools, providers, credentials, and data egress.

Its purpose is to ensure that intelligence, role, skill, model choice, or organizational seniority never becomes implicit authority.

This stage is architecture/governance closure only. It does **not** authorize implementation and does not supersede the mandatory Environment Readiness Gate.

---

## 2. Canonical Security Principles

- Local does not mean trusted.
- Deny by default; explicitly authorize; grant minimum necessary access.
- Human Identity, Employee Identity, Runtime Principal, and External Credential are separate concepts.
- Tool access does not come automatically from Role, Skill, Model, or Department.
- Secrets do not enter prompts, ordinary memory, ordinary SQLite state, Git, artifacts, or logs.
- Natural-language input is untrusted data and cannot grant authority.
- Security/privacy gates execute before cost or quality optimization.
- Provider authorization does not authorize that provider's external tools or third-party destinations.
- Managerial hierarchy does not imply permission inheritance.
- Authorization is re-evaluated at the action boundary.
- No agent may self-escalate permissions, budgets, credentials, or risk authority.

---

## 3. Accepted Decision Groups

### D14-A — Trust, Identity & Secret Foundation — ACCEPTED

1. QANDEEL uses a Zero-Trust-style internal posture even in local-first Strong v1.
2. Human Identity, Employee Identity, Runtime Principal, and External Credential remain distinct.
3. Tool access is granted through explicit policy, not inferred from Role or Skill.
4. Agents/models do not normally receive secret values; governed executors use credentials privately.
5. Strong v1 local secret protection uses a Windows user-scoped vault approach; machine-wide exposure is not the default.
6. Model-visible natural language is untrusted data and cannot override runtime policy.
7. Sensitive actions use scoped, short-lived authorization grants tied to the approved action/work context.

### D14-B — Data Classification & Provider Egress — ACCEPTED

QANDEEL data classes:

- D0 — PUBLIC
- D1 — INTERNAL
- D2 — CONFIDENTIAL
- D3 — RESTRICTED
- D4 — SOVEREIGN / SECRET

Canonical rules:

1. The highest data class in the outbound context governs egress unless safe minimization/redaction changes the payload before transmission.
2. D4 is local-only and does not go to external LLM providers in ordinary operation.
3. Egress approval is assigned to a specific Deployment/Egress Profile, not merely a provider brand.
4. Privacy/egress eligibility is evaluated before capability, quality, cost, or latency routing.
5. No provider receives a permanent D3 approval by brand name alone; actual account/endpoint/region/feature/retention conditions must be qualified.
6. Data minimization applies even when a destination is permitted.
7. External tools, web access, MCP servers, and third-party destinations create a new independent egress decision.
8. Egress decisions are auditable without duplicating sensitive payloads into logs.

### D14-C — Permission & Capability Grant Model — ACCEPTED

1. Authorization is deny-by-default and least-privilege.
2. QANDEEL uses a hybrid policy model: role may provide a baseline, but actual authorization depends on subject, action, resource, risk, work context, and environment.
3. Grants are scoped to specific capability/action/resource boundaries, data class, risk ceiling, expiry, and approval conditions.
4. Permissions do not automatically inherit through management or department hierarchy.
5. Sensitive permissions are Just-in-Time / temporary where practical.
6. Authorization is checked at each sensitive action boundary, not only when the run begins.

### D14-D — Secrets Lifecycle & Credential Rotation — ACCEPTED

1. Secrets have an explicit lifecycle: Create → Activate → Use → Rotate → Revoke → Expire.
2. Short-lived/dynamic credentials are preferred when supported.
3. Rotation is governed and dependency-aware, not blind.
4. Suspected secret compromise triggers immediate revocation/containment rather than waiting for routine rotation.
5. Strong v1 local secret storage uses Windows user-scoped protection as the initial operating boundary.
6. Logs retain secret metadata and usage events, never plaintext secret values.

### D14-E — Security Audit, Detection & Incident Controls — ACCEPTED

1. Security-sensitive actions and decisions are auditable.
2. Audit records are append-oriented/protected from ordinary agent modification or deletion.
3. Secrets and unnecessary sensitive payloads are excluded/redacted from logs.
4. Core detection rules are deterministic/runtime-enforced; LLM analysis may assist but is not the only guard.
5. Response severity can progress through LOG → ALERT → TEMPORARY HOLD → REVOKE/CIRCUIT BREAK → FOUNDER ESCALATION.
6. Confirmed real security failures become persistent regression/security tests.

---

## 4. Scope Boundary / Explicit Deferrals

The following are intentionally not expanded inside Stage 14:

- backup, restore, disaster recovery, degraded-mode continuity, vault recovery after device loss, and secure migration/re-key procedures → **Stage 15 — Resilience / Backup / Recovery**;
- founder-facing operational security controls and control-room UX → **Stage 16 — Founder Command Center**;
- long-horizon security/performance reporting and learning analytics → **Stage 17 — Reporting / Performance / Learning**;
- real controlled proof under production-like operating conditions → **Stage 18 — Controlled Pilot → Strong v1 Closure**.

---

## 5. Final Gap Review

### PASS — no Stage-14-blocking product/architecture gap remains.

Stage 14 now defines sufficient contracts for:

- explicit identity and trust boundaries;
- least-privilege capability authorization;
- scoped/JIT grants and action-bound approvals;
- secure secret custody and lifecycle;
- data classification and provider egress control;
- external-tool/third-party egress re-authorization;
- auditability and deterministic misuse detection;
- automatic containment without granting agents new authority.

The D14 proof condition is satisfied architecturally:

> **A compromised, manipulated, or hallucinating employee remains constrained by runtime-enforced permissions, egress policy, secret isolation, and governed action execution.**

No additional D14 decision group is required before closure.

---

## 6. Implementation Preconditions Preserved

Stage 14 closure does not authorize implementation.

Before implementation begins, the mandatory **Environment Readiness Gate** must PASS, including Windows/PowerShell/Git/GitHub, runtimes/package managers, CLIs/connectors, permissions, services, ports/IPC, long-path handling, certificates/security restrictions, SQLite/WAL/file locking, backup/restore smoke tests, runtime lifecycle, model/provider connectivity, tool connectivity, and pinned/known dependency versions.

A clear Environment Manifest remains required.

---

## 7. Closure Record

**Stage 14 — Security / Permissions / Secrets: CLOSED / ACCEPTED**  
**Gate D14: PASS**  
**Canonical package:** `QANDEEL_COMPANY_STAGE_14_CANONICAL_CLOSURE_v1.zip`  
**Strong v1 progress:** **81% CLOSED / 19% REMAINING**

Next planned stage:

**Stage 15 — Resilience / Backup / Recovery**

Do not reopen Stage 14 unless a real contradiction, implementation proof failure, or downstream requirement requires a formal amendment.
