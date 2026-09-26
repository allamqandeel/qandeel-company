# Company Architecture Authority — Index

**Status:** INDEX to the imported canonical authority. Recorded at PRE-C1 Authority Sync & Import
(2026-09-26), from baseline `08c74175`.
**Provenance:** [`AUTHORITY_IMPORT_MANIFEST.md`](AUTHORITY_IMPORT_MANIFEST.md) gives the source,
SHA-256 and classification of every file.

## 1. What this is

This directory holds the detailed pre-implementation Product / Architecture authority for QANDEEL
COMPANY:
- the Stage 0–17 canonical closures;
- the living founding set as of its latest version.

The Founder and Product Owner produced these files before implementation, and they existed only as
local archives. They were imported so that a Cloud executor can work from the repository alone.

- Every imported file is an **exact byte copy** of its source, with its original name. Nothing was
  rewritten, paraphrased, merged or corrected.
- Much of the founding set is in Arabic. It is authority exactly as written; no translation was
  added.

## 2. What this is not

- **Not a new Product / Architecture stage.** PRE-C1 prepared the repository for Cloud execution.
- **Not evidence of implementation.** A closed stage is a closed *design contract*. Implementation
  state is whatever canonical `main` contains (`IMPLEMENTATION_AUTHORITY_RULES.md` rule 2).
- **Not editable by implementation work.** Do not change these files to match code. A
  contradiction goes to the Product Owner as a formal amendment, as the closures themselves
  require ("Do not reopen Stage N unless ...").
- **Not QANDEEL App authority.** No App document was imported. App semantics, including the App's
  own APP-OPS-01 contract, stay in the App repository.

## 3. Files and classification

| Directory | Contents | Classification |
|---|---|---|
| `FOUNDING/` | `…FOUNDING_CONSTITUTION_v0.1.md`, the living constitution. §3 holds the non-negotiable principles; §17–28 name each Stage 1–12 document as the "Detailed canonical authority" | CANONICAL / FINAL in the task's taxonomy: the latest of 14 versions. Its own status is `LIVING / VERSIONED`, and it says it is not a final closed constitution; later stage closures govern their scope |
| `FOUNDING/` | `…STRONG_V1_MASTER_PLAN_v0.1.md`: roadmap, weights, gates and the Strong v1 Definition of Done (§8) | CANONICAL / FINAL in the task's taxonomy: the latest of 14 versions. Its own status is `ACTIVE PLANNING / EDITABLE`; its Stage 13–17 plans and §9 status are superseded by the later closures (§6 below) |
| `FOUNDING/` | `…CHANGE_LOG_v0.1.md` (CHG-000..017), `…CHECKPOINT_REGISTER_v0.1.md` (QC-000..017) | EVIDENCE ONLY — history as of Stage 12 |
| `STAGE_00/` … `STAGE_12/` | the stage's canonical document, plus its closure record | CLOSED / FROZEN + FINAL CLOSURE RECORD |
| `STAGE_13/`, `STAGE_14/`, `STAGE_15/`, `STAGE_17/` | `STAGE_NN_CANONICAL_CLOSURE_v1.md`, `DNN_DECISION_REGISTER.md`, `DNN_DOWNSTREAM_HANDOFF.md` | FINAL CLOSURE RECORD + CLOSED / FROZEN |

Stage subjects:
- **Foundation.** 0 Product Definition & Boundaries · 1 Company Constitution · 2 Ontology &
  Canonical State · 3 Authority / Risk / Governance.
- **Employees.** 4 Employee Identity & Lifecycle · 5 Memory & Knowledge · 6 Academy &
  Certification · 7 Skills / Tools / Capability.
- **Working company.** 8 Work Operating System · 9 Communication & Collaboration · 10 Departments &
  Management · 11 Review / Oversight / Quality.
- **Runtime and later.** 12 Local-first Company Runtime · 13 Model & Agent Runtime · 14 Security /
  Permissions / Secrets · 15 Resilience / Backup / Recovery · 17 Reporting / Performance /
  Learning.
- **Not yet reached.** Stage 18, Controlled Pilot → Strong v1 Closure, is planned but not reached;
  it maps to the implementation map's Pilots.

## 4. Reading order

1. `FOUNDING/QANDEEL_COMPANY_FOUNDING_CONSTITUTION_v0.1.md` §2–3 and §17–28. These are the
   principles, followed by a one-screen summary of every Stage 1–12 decision.
2. `STAGE_00/` (product boundary), then `STAGE_01/`–`STAGE_03/` (constitution, ontology,
   authority / risk).
3. The stages that govern your work package, read **in full**, together with every later stage that
   binds over them.

   These stages are commonly relevant to the durable runtime (C1). Your Task Contract, not this
   list, sets scope:

   | Stage | Parts |
   |---|---|
   | 2 | ontology, canonical state, identity, history |
   | 8 | Work Items, ownership, lifecycle, dependencies, retry / idempotency, checkpoint / resume |
   | 12 | runtime service, SQLite / WAL, durable runs, queue, leases, recovery, migrations, IPC |
   | 13 | D13-D and D13-E: runtime-owned loop, durable run state machines, event-driven WAIT, runtime state ≠ model context |
   | 14 | deny-by-default, identity separation, secret boundary |
   | 15 | D15-C and D15-D: checkpoints, safe resume, reconciliation, migration / rollback |
4. `FOUNDING/QANDEEL_COMPANY_STRONG_V1_MASTER_PLAN_v0.1.md` §8, the Definition of Done, and §3 for
   gates.
5. Evidence (the change log and the checkpoint register) only when you need decision history.

## 5. Missing source artifacts

**STAGE 16 SOURCE ARTIFACT — NOT FOUND IN LOCAL AUTHORITY SET.**

Stage 16 is Founder Command Center. The local authority set has no Stage 16 closure. It was not
reconstructed, and nothing was inferred from Stage 15 or Stage 17.

What the imported canonical set *does* say about the Stage 16 area. Each item is usable only for
what it is:
- **Pre-Stage-16 planning and principles, not Stage 16 decisions:**
  - Founding Constitution §13, Founder Command Center principles;
  - Master Plan §3, the planned Stage 16 sub-stages 16.1–16.12 and Gate E16;
  - the Stage 13, 14 and 15 downstream handoffs, the items "carried forward" to Stage 16.
- **Later-source authority in adjacent scope.** Stage 17 (D17), Founder Decision 6, sets Founder
  reporting as exception-first and conversational: daily brief, weekly and monthly reviews, and
  on-demand natural-language queries. The Stage 17 handoff requires the pilot to validate "Founder
  conversational management and approval flow".
- **Nothing more.** No later canonical source explicitly restates a Stage 16 decision.

A pointer for the Product Owner, not a reconstruction: the Stage 15 closure names Stage 16 as its
"Next planned stage", and the Stage 17 handoff (`D17_DOWNSTREAM_HANDOFF.md`) asks Stage 18 to prove "the
Stage 0–17 contracts". Together these suggest a Stage 16 closure was produced and its artifact is
missing locally, rather than that Stage 16 was skipped. Only the Product Owner can confirm this.

Stage 16 scope maps to implementation package `C5`. It is **not** needed for `C1`. Before `C5`, the
Product Owner must supply the Stage 16 authority or decide how `C5` proceeds without it.

## 6. Precedence and known observations

**Precedence.**
- Inside its scope, a stage's closure governs.
- A later explicit closure governs over earlier planning text for the same subject.
- Canonical truth outranks memory and summaries, as Stage 5 requires.

**Observations.** None of these is an authority conflict, and none needs a Product decision for
`C1`.

| # | Observation | Reading |
|---|---|---|
| O1 | The Master Plan names gates `E16`, `E17` and `F18`. The Stage 17 closure calls its gate `D17`. | Naming only; it is the same stage. |
| O2 | Master Plan §3 plans Stage 13 with provider adapter sub-stages (13.2 GPT adapter, 13.3 Claude adapter, 13.4 Codex/coding adapter). The Stage 13 closure decides on provider-independent routing, and D13-D.10 makes no agent framework canonical. | The later closure governs its scope. |
| O3 | The Master Plan (§9), the change log and the checkpoint register stop at Stage 12 (73%). The standalone closures record 77% / 81% / 85% for Stages 13 / 14 / 15, and Stage 17 closed. | The Stage 12-era status lines are historical. |
| O4 | `STAGE_00/…PRODUCT_DEFINITION_v0.1.md` is titled "Working Record v0.1" but carries `Status: CLOSED / ACCEPTED`. | The closed status governs. |
| O5 | `COMPANY_CANONICAL_BASELINE.md` §4 says "voice-forward". The imported set does not mention voice. | That is a direct Product Owner decision in the C0 contract. It is compatible, since no source excludes voice. |

## 7. Privacy rules checked against this set

The Product Owner's direct privacy decisions are recorded in `COMPANY_CANONICAL_BASELINE.md` §5 as
Rules A, B and C; that section's wording governs. **Rule A:** Operational telemetry is ALWAYS
content-free. **Rule B:** APP-OPS-01 itself provides no path by which Company Operations receives
private user content. **Rule C:** No routine or exceptional human review of private QANDEEL
conversation content is authorized through Company Operations or safety-monitoring flows.

The imported set was searched for content paths, telemetry, human review and moderation. The result
is **no conflict**:
- **Content paths and human review.** No imported source creates an App-to-Company private-content
  path, and none authorizes human review of QANDEEL App conversation content.
- **Stage 1 §7.** It says user data "may not be exposed without authority". That restricts
  exposure; it grants no path.
- **Stage 11 calibration.** It uses trusted human, Founder or Director judgments on *Company* work.
  That is not App conversation content.
- **Stage 12 §46, Stage 13 D13-D.9 and Stage 14 D14-B.8 / D14-E.3.** They require redaction,
  exclude raw chain-of-thought from traces and keep sensitive payloads out of logs. Rule A is
  stricter for operational telemetry, and both hold together.
- **Stage 5 §8 and Stage 10 §10–11.** "customer/user context" retrieval, "Customer Intelligence /
  Support", and "ratings/review monitoring" (public store reviews) are the places most likely to
  press on Rule B later. None of them creates a private-content path or assumes human review of
  App conversation content.

## 8. Relation to the other authority documents

| Document | Role | Relation to this set |
|---|---|---|
| `docs/authority/COMPANY_CANONICAL_BASELINE.md` | implementation-facing summary of approved decisions, including the direct privacy rules | **Summarizes; does not replace.** When this set holds detailed authority on a subject, implement from this set, not from the summary. |
| `docs/authority/IMPLEMENTATION_AUTHORITY_RULES.md` | who decides; how work reaches `main` | Governs how this set is used and amended. |
| `docs/architecture/IMPLEMENTATION_MAP.md` | implementation sequencing (L0, C0, C1…) | The implementation packages do not map one-to-one onto Stages. The map does not change the Stages. |
| `docs/architecture/BOUNDARIES.md` | boundaries code must not cross | Consistent with Stages 12–14; this set holds the detail. |
| `docs/architecture/DECISION_LOG.md` | engineering decisions | D-PRE-C1-01 records this import. |
| your Task Contract | scope and anti-scope of the current work package | Defines *what* you build. This set defines the Product / Architecture rules it must obey. |

**Conflicts.** If this set and a later direct Product Owner decision conflict, do not choose
silently. Record `AUTHORITY CONFLICT — PRODUCT OWNER REVIEW REQUIRED` and stop if it affects your
work. None is known at import time.
