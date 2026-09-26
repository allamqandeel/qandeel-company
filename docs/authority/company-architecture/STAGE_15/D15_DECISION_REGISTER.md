# D15 Decision Register

| Decision Group | Status | Canonical Scope |
|---|---|---|
| D15-A — Resilience Objectives & Failure Model | ACCEPTED | Explicit failure classes, criticality tiers, workload-specific RPO/RTO, off-device recovery, consistent backups, restore verification |
| D15-B — Backup Topology & Device-loss Recovery | ACCEPTED | Multi-layer backup topology, retention generations, encrypted off-device/offline copies, portable recovery, clean-device restore |
| D15-C — Crash Recovery, Checkpoints & Safe Resume | ACCEPTED | Durable checkpoints, resume/retry/reconcile classification, idempotency, startup recovery ordering, crash-loop containment |
| D15-D — Update/Migration Failure & Rollback | ACCEPTED | Pre-update snapshots, maintenance state, versioned migrations, verification-before-promotion, rollback/restore to known-good state |

## Canonical Resilience Principle

`Backup != Recovery Proof`

QANDEEL considers data protected only when a consistent backup exists, its integrity is verifiable, and the company state can be restored and safely resumed without duplicating uncertain external side effects.
