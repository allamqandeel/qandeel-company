# D14 Decision Register

| Decision Group | Status | Canonical Scope |
|---|---|---|
| D14-A — Trust, Identity & Secret Foundation | ACCEPTED | Zero-trust posture, identity separation, secret isolation, scoped sensitive authorization |
| D14-B — Data Classification & Provider Egress | ACCEPTED | D0–D4 classification, deployment-specific egress profiles, privacy-first routing, third-party re-authorization |
| D14-C — Permission & Capability Grant Model | ACCEPTED | Deny-by-default, hybrid authorization, scoped/JIT grants, no hierarchy inheritance |
| D14-D — Secrets Lifecycle & Credential Rotation | ACCEPTED | Secret lifecycle, short-lived credentials, governed rotation/revocation, local protected vault |
| D14-E — Security Audit, Detection & Incident Controls | ACCEPTED | Protected audit trail, deterministic detection, containment ladder, regression security tests |

## Canonical Security Principle

`Intelligence != Authority`

An employee, model, role, skill, tool description, or natural-language instruction cannot create permission. Authority exists only through explicit runtime-enforced policy and valid grants.
