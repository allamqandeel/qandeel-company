# QANDEEL COMPANY — Strong v1
## Stage 15 — Resilience / Backup / Recovery
### Canonical Closure v1

**Status:** CLOSED / ACCEPTED  
**Gate:** D15 — PASS  
**Gate proof:** Company state can recover from crashes, corruption, failed updates, and device loss without uncontrolled data loss, duplicated side effects, or weakened security boundaries.  
**Strong v1 progress after closure:** 85% CLOSED / 15% REMAINING  
**Previous canonical dependency:** QANDEEL_COMPANY_STAGE_14_CANONICAL_CLOSURE_v1.zip

---

## 1. Stage Purpose

Stage 15 defines how QANDEEL survives runtime crashes, host restarts, corrupted operational state, accidental deletion, failed updates/migrations, security incidents, and complete loss of the Strong v1 Windows device.

Its purpose is not merely to create backups. It defines recovery objectives, backup topology, durable checkpoints, safe resume/retry/reconciliation, isolated restore, device portability, and rollback to known-good state.

This stage is architecture/governance closure only. It does **not** authorize implementation and does not supersede the mandatory Environment Readiness Gate.

---

## 2. Canonical Resilience Principles

- Backup is not considered successful merely because files were copied.
- Recovery objectives depend on data/work criticality; QANDEEL does not use one global RPO/RTO for everything.
- Critical committed operational state should minimize recoverable data loss during ordinary crashes.
- Same-device backup alone is insufficient for device-loss recovery.
- Off-device backup is encrypted; critical recovery material must survive loss of the original laptop.
- Cloud synchronization alone is not treated as a backup architecture.
- Live SQLite state is backed up through an application-consistent mechanism rather than unsafe raw file copying.
- Every backup has provenance/manifest/checksum information sufficient for verification.
- Restore capability is proven through isolated restore drills.
- Work resumes from durable checkpoints rather than reconstructing intent from LLM conversation history.
- Retry, resume, and reconciliation are distinct recovery actions.
- External mutations with uncertain outcomes are reconciled before repetition.
- Crash loops, retry storms, and mass startup fan-out are bounded.
- Updates/migrations are promoted only after verification and preserve a known-good recovery path.
- Recovery never weakens Stage 14 authorization, secret, audit, or egress controls.

---

## 3. Accepted Decision Groups

### D15-A — Resilience Objectives & Failure Model — ACCEPTED

1. QANDEEL explicitly designs for runtime/process crash, Windows/device restart, database corruption, accidental deletion, failed update/migration, security incident, and complete device loss/failure.
2. Runtime data is classified operationally as Critical, Important, or Rebuildable for recovery purposes.
3. RPO/RTO are set by workload/data criticality rather than one universal target.
4. Same-device backup is insufficient; Strong v1 requires an encrypted copy outside the laptop failure domain.
5. Live SQLite/WAL state is captured through an application-consistent backup mechanism.
6. Backups include verification metadata and are periodically proven through isolated restore/integrity checks.

### D15-B — Backup Topology & Device-loss Recovery — ACCEPTED

1. Strong v1 uses at least: live working state, local fast-recovery snapshot, and encrypted off-device backup; critical state also receives a periodic offline/immutable-style recovery copy where practical.
2. Retention is generational/multi-level rather than keeping only the latest copy; exact intervals are calibrated during implementation/pilot from data size and operational evidence.
3. Generic cloud sync is not treated as the backup mechanism, though a properly encrypted backup package may use an approved remote storage destination.
4. Windows user-scoped secret protection is not the only recovery dependency; device-loss recovery requires a portable encrypted recovery path and separately protected recovery material.
5. Device-loss recovery restores the company onto a clean Windows environment using the Environment Manifest, runtime, database/artifacts, secret re-key/import, integrity verification, and controlled resume.
6. Security-incident restore is isolated and credential-sensitive; compromised credentials are not blindly restored and reused.

### D15-C — Crash Recovery, Checkpoints & Safe Resume — ACCEPTED

1. Important Work Items maintain durable checkpoints for meaningful execution progress and state.
2. Post-crash work is classified as SAFE_TO_RESUME, SAFE_TO_RETRY, or RECONCILIATION_REQUIRED.
3. External mutations use stable operation/idempotency identifiers where the destination supports them.
4. Startup recovery reconciles durable state before normal worker fan-out resumes.
5. Completion is not assumed across an ambiguous crash boundary; uncertain side effects enter explicit reconciliation state.
6. Repeated recovery failure is bounded and escalates to quarantine/dead-letter/alert rather than creating crash or retry storms.

### D15-D — Update/Migration Failure & Rollback — ACCEPTED

1. Material updates/migrations require a pre-update snapshot and manifest of the known-good state.
2. Sensitive migrations occur inside an explicit maintenance lifecycle: Preflight → Backup → Migrate → Verify → Activate.
3. Database/schema migrations are versioned; unsafe downgrade is not attempted when restore from a compatible snapshot is the safer path.
4. Promotion occurs only after schema/integrity/startup/critical read-write verification passes.
5. Failed update activation stops and enters UPDATE_HOLD / safe rollback rather than cascading automated retries.
6. The previous known-good runtime version and compatible snapshot remain available for a bounded rollback period until the new version is proven stable.

---

## 4. Scope Boundary / Explicit Deferrals

The following are intentionally not expanded inside Stage 15:

- founder-facing recovery/health dashboards and operational control UX → **Stage 16 — Founder Command Center**;
- long-horizon reliability analytics, recovery-performance reporting, and organizational learning → **Stage 17 — Reporting / Performance / Learning**;
- real production-like proof of recovery, restart, device-loss, and rollback behavior → **Stage 18 — Controlled Pilot → Strong v1 Closure**.

Stage 15 also does not reopen Stage 12 runtime architecture or Stage 14 security policy. It extends them with recovery contracts only.

---

## 5. Final Gap Review

### PASS — no Stage-15-blocking product/architecture gap remains.

Stage 15 now defines sufficient contracts for:

- explicit failure-model coverage;
- criticality-based recovery objectives;
- consistent and verified backups;
- encrypted off-device/device-loss recovery;
- recovery of protected secrets without making the original device the sole trust anchor;
- durable crash checkpoints and bounded startup recovery;
- idempotent retry and uncertain-side-effect reconciliation;
- update/migration verification and rollback to known-good state;
- preservation of security/authority boundaries throughout recovery.

The D15 proof condition is satisfied architecturally:

> **QANDEEL can recover company state and continue controlled work after realistic failures without relying on LLM memory, blind retries, or a single-device backup assumption.**

No additional D15 decision group is required before closure.

---

## 6. Implementation Preconditions Preserved

Stage 15 closure does not authorize implementation.

Before implementation begins, the mandatory **Environment Readiness Gate** must PASS, including Windows/PowerShell/Git/GitHub, runtimes/package managers, CLIs/connectors, permissions, services, ports/IPC, long-path handling, certificates/security restrictions, SQLite/WAL/file locking, backup/restore smoke tests, runtime lifecycle, model/provider connectivity, tool connectivity, and pinned/known dependency versions.

The Environment Manifest remains required.

Stage 15 implementation must additionally prove isolated restore and recovery smoke tests before resilience claims are treated as operationally verified.

---

## 7. Closure Record

**Stage 15 — Resilience / Backup / Recovery: CLOSED / ACCEPTED**  
**Gate D15: PASS**  
**Canonical package:** `QANDEEL_COMPANY_STAGE_15_CANONICAL_CLOSURE_v1.zip`  
**Strong v1 progress:** **85% CLOSED / 15% REMAINING**

Remaining planned stages:

- **Stage 16 — Founder Command Center — 6%**
- **Stage 17 — Reporting / Performance / Learning — 4%**
- **Stage 18 — Controlled Pilot → Strong v1 Closure — 5%**

Next planned stage:

**Stage 16 — Founder Command Center**

Do not reopen Stage 15 unless a real contradiction, implementation proof failure, or downstream requirement requires a formal amendment.
