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

Future APP-OPS (`APP-OPS-01`) is **governed telemetry / control integration**, not shared private
conversation storage. It carries no private QANDEEL conversation text, audio, transcripts, Memory
or Analysis unless separately authorized Product authority says otherwise.
