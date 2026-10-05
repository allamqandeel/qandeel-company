# Boundaries

**Status:** CANONICAL — recorded at C0 (2026-09-26). Crossing a boundary requires a Product /
Architecture decision, not an implementation convenience.

## Product boundary

**Company ≠ App.** QANDEEL COMPANY (`allamqandeel/qandeel-company`) and the QANDEEL App are
separate products, repositories, runtimes and data stores. They share no source tree, database,
runtime state, secrets, build output or dependency directories. The Founder-local App checkout
(`E:\QANDEEL\QANDEEL PROJECT`) is never a dependency, import path or write target of this
repository.

## Identity boundary

**Founder / human identity ≠ Employee ≠ Runtime Principal ≠ External Credential.** A human is
never impersonated by an Employee; an Employee is not a credential; a credential never becomes an
identity.

## Model boundary

**Employee ≠ Model.** Provider and model selection is infrastructure / runtime policy, not
Employee identity. Changing a model does not change who the Employee is.

## Persistence boundary

Canonical local durable state lives on the Founder's machine and **must not depend on a Cloud
session VM**. Cloud sessions are disposable.

## Secret boundary

Plaintext secrets are never committed and never placed in prompts, artifacts, SQLite business data
or agent memory. Local secret protection uses Windows user-scoped protection (proven in L0).

## Tool boundary

A model's ability to **request** a tool does not imply authority to **execute** it. Execution is
decided by the runtime's authority path, not by the model.

## Cloud boundary

Claude Cloud is a **build / execution environment for development**, not the canonical operational
home of QANDEEL COMPANY. Results come home through GitHub branches / PRs and are validated locally.

## App operations boundary

`APP-OPS-01` is the **governed App ↔ Company operational boundary**. It is not shared
private-conversation storage. Its App-side Product / Architecture contract is CLOSED / FROZEN (lifecycle
sync at the C7-A start, 2026-10-01). The Company side is built in `C7` (C7-A … C7-D): C7-A (closed) adds
only the Company-side governed intake contract, with no App transport, connector or network listener; C7-B
(closed) adds only the Company-side governed desired-control plane; C7-C (closed) adds only Company-internal Pilot instrumentation over canonical Company evidence and reads nothing from the App; C7-D (closed) adds Company-side digital presence capability (an internal workshop, an isolated internal Preview, exact candidates and governed promotion through the Tool Executor) and reads nothing from the App. Transport, App-side
consumption and enforcement stay later work (App-side Production Integration / L1) under their own authority.

Three separate rules apply (see `docs/authority/COMPANY_CANONICAL_BASELINE.md` §5):
- **Operational telemetry is ALWAYS content-free.** It carries no private conversation text,
  audio, transcripts, prompts, model-output content, Memory, Analysis or equivalent private
  semantic payload, and it has no incident or safety-monitoring exception.
- **APP-OPS-01 itself provides no path by which Company Operations receives private user content.**
  A user-initiated support-sharing path would be outside APP-OPS-01 and needs separate, explicit
  Product authority before it exists.
- **No routine or exceptional human review of private QANDEEL conversation content** is authorized
  through Company Operations or safety-monitoring flows.
