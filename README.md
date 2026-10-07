# QANDEEL COMPANY (قنديل)

QANDEEL COMPANY is a bespoke, local-first AI company built to operate and manage the QANDEEL
product and business. The Founder remains the human Product Authority; the Company's work is
governed and auditable.

> **Separate from the QANDEEL App.** The App is a different repository, product, runtime and data
> boundary. Nothing here imports, reads or writes the App. Integration happens only through the governed
> `APP-OPS-01` boundary (its App-side contract is frozen). C7-A adds only the Company-side governed intake contract
> and C7-B only the Company-side record of governed, issued (desired) controls; no App transport or connector exists,
> nothing the Company issues is effective in the App until the App applies it, and operational telemetry is always
> content-free.

## Current state

| Step | State |
|---|---|
| `L0` Environment Readiness | CLOSED / PASS |
| `C0` Repository Bootstrap | CLOSED / PASS |
| PRE-C1 Authority Sync & Import | Complete (merged). Documentation / authority only |
| `C1` Company Foundation & Durable Runtime | CLOSED / MERGED / CANONICAL (`main` @ `419ee4f`) |
| `C2` Employees + Models + Tools + Cost Governance | CLOSED / MERGED / CANONICAL (PR #3, `d374001`) |
| `C3` Memory + Context + Skills + Academy | CLOSED / MERGED / CANONICAL (PR #4, `4592b52`) |
| `R1` Independent Core Review | CLOSED / MERGED / CANONICAL (PR #6, `bd18614`) |
| `C4` Organization + CEO + Directors + Delegation + Review Pool | CLOSED / MERGED / CANONICAL (PR #8, `595083a`) |
| `C5` Founder Command Center (Tree of Light) | CLOSED / MERGED / CANONICAL (PR #10, `7c45f2a`; `docs/C5_CLOSURE_RECORD.md`) |
| `C6` Company Improvement Engine (Evaluation + Attribution + Learning + Reporting + Resilience) | CLOSED / MERGED / CANONICAL (PR #11, `b4f91ca`; `docs/C6_CLOSURE_RECORD.md`) |
| `R2` Full Strong-v1 Independent Review | CLOSED / MERGED / CANONICAL (PR #12, `2eafbed`; `docs/R2_CLOSURE_RECORD.md`) |
| `C7-A` Operational Data + External Outcome Core (C7 = C7-A … C7-D) | CLOSED / MERGED / CANONICAL (PR #13, `e7ca688`; `docs/C7A_CLOSURE_RECORD.md`) |
| `C7-B` Governed App Operations Control Plane | CLOSED / MERGED / CANONICAL (PR #14, `c06fd2e`; `docs/C7B_CLOSURE_RECORD.md`) |
| `C7-C` Pilot Instrumentation Pack | CLOSED / MERGED / CANONICAL (PR #15, `f450d6a`; `docs/C7C_CLOSURE_RECORD.md`) |
| `C7-D` Digital Presence Creation & Operations | CLOSED / MERGED / CANONICAL (PR #16, `3d835ec`; `docs/C7D_CLOSURE_RECORD.md`) — C7 complete |
| `L1-01` DeepSeek V4.1 Flash live provider + Windows secure vault + first local bring-up | CLOSED / MERGED / CANONICAL (PR #17, `11805a9`; `docs/L1_01_CLOSURE_RECORD.md`) |
| `L1-02` First Production Company Activation (permanent workspace, first real CEO through hire → Academy → activation) | CLOSED / MERGED / CANONICAL (PR #18, `725508f`; `docs/L1_02_CLOSURE_RECORD.md`) — Salim Nasser is the ACTIVE production CEO |
| `OPS` Operational / Desktop Packaging (open / reopen / close / stop / restart / recover the Company from Windows, no terminal) | CLOSED / MERGED / CANONICAL (PR #19, `d86be37`; `docs/OPS_FOUNDER_DESKTOP_PACKAGING_REPORT.md`) |
| `C5-CORR-01` / `C5-CORR-02` English application chrome; Goal Focus leader geometry | CLOSED / MERGED / CANONICAL (PR #20, `cf1578e`; PR #21, `c88afbc`) |
| `D0` Final Engineering & Validation Closure (proportional validation, D-D0-01) | CLOSED / MERGED / CANONICAL (PR #22, `074673b`) |
| `D1` Desktop v1 Productization Mega Stage (the former D1 + D2 + D3: `QANDEEL-COMPANY-Setup.exe`, private runtime, update / rollback / repair / uninstall; D-D1-01 … D-D1-07) | ACTIVE — not closed |
| `D2` Founder Laptop Acceptance (the former D4) | Not started — QANDEEL COMPANY Desktop v1 closes only when the signed Founder RC is installed, running and accepted |
| `P1` First Production Staffing under Salim | **PAUSED** by Founder decision until Desktop v1 is installed and accepted (`docs/architecture/IMPLEMENTATION_MAP.md`) |

**C1 builds the durable runtime foundation, not the intelligent Company.** It adds:
- Work Items, a durable queue, Runs and checkpoints on SQLite/WAL, with atomic claims, lease fencing
  and bounded retry/dead-letter;
- event-driven wake-up, startup recovery and graceful shutdown;
- an Artifact Store, online backup with isolated verification, and health/readiness;
- an engineering CLI.

C1 itself has no AI subsystem. Details: `docs/c1/C1_SCHEMA_AND_STATE.md`,
`docs/c1/C1_RUNTIME_RECOVERY_MODEL.md`, `docs/C1_IMPLEMENTATION_REPORT.md`.

**C2 (closed) adds the governed execution layer.** It covers:
- persistent Employees: identity, lifecycle and history, independent of every model, provider,
  session, run and process;
- a provider-neutral model catalog and Router Policy: `E0..E4`, qualification lifecycle, hard
  privacy / qualification / hold gates before cost, bounded retry ≠ fallback ≠ escalation;
- `D0..D4` data egress (external egress stops at D2 until a qualified D3 egress profile exists);
- R0–R4 authority with default deny and scoped, durable Founder approvals. Founder authority fails
  closed until the authenticated Founder surface (C5), and activation fails closed until C3
  certification (D-C2-13);
- a Tool Registry with a governed Tool Executor;
- hierarchical hard token / cost budgets with worst-case reservation before every call.

All of this runs inside the C1 durable runtime. C2 chooses **no commercial provider**: its only
provider and tools are deterministic fakes, so CI makes no network or paid call and uses no
credential. Details: `docs/C2_IMPLEMENTATION_REPORT.md`, decisions D-C2-01 to D-C2-13.

**C3 (closed / merged / canonical) adds the Employee mind.** It covers:
- governed Employee Memory with a runtime-owned Memory Write Policy: model output is only a
  *candidate*; provenance, confidence caps, duplicates, secrets, staleness, conflicts, corruption
  and Founder corrections are decided by the runtime, and Canonical Truth always outranks memory;
- scoped Company Knowledge (Company / Department / Role / Market / Restricted / Founder-only) with
  exact grants and attributed cross-department use, and the learning path observation → lesson
  candidate → review → validated lesson → promotion (shared promotion waits for independent review);
- **mandatory governed Context Assembly** for every inference: deterministic lexical retrieval over
  a bounded metadata pool, a hard layered budget, progressive Skill disclosure, a stable prefix and
  a content-free Context Manifest to which every model-call reservation is bound;
- the Skill Registry and pipeline (license / dependency check, static inspection, quarantine,
  security review, benchmark, approval), pinned versions, Role Skill Blueprints, Employee Skill
  Passports, freshness / security holds, update impact sets, rollout and rollback; Skill ≠ Tool ≠
  Authority, and no paid Skill packs;
- durable Capability Gaps that park work before any model or tool call;
- the QANDEEL Academy: programs, scenarios and holdouts, attempts executed by the real runtime in
  constrained mode, critical-dimension gating, diagnosis and retraining, shadow work, probation
  review, certification with pinned skills, recertification, loss of a revoked / expired role
  certification (ACTIVE → RETRAINING), and ACTIVE role reassignment without a VALID target-role
  certification (assignment recorded, then RETRAINING), Founder calibration before activation for
  designated roles — and the **activation bridge**, which files an activation request that production cannot approve
  until the authenticated Founder surface exists (C5).

C3 adds no external vector database, embedding service or paid memory service. Details:
`docs/C3_IMPLEMENTATION_REPORT.md`, decisions D-C3-01 onward.

**C4 (closed / merged / canonical) adds the organization.** It covers:
- the canonical Strong-v1 skeleton, release-seeded and vacant: Founder → a company-scoped **CEO seat** (no
  Department, never a fake Executive Department) → five **Director seats** (Strategic Market Intelligence,
  Growth, Brand & Creative, Product, **Engineering**) with baseline charters; no identity or headcount
  invented;
- Positions and effective-dated **assignments** as organization truth (PRIMARY / bounded ACTING coverage),
  time-correct run attribution, per-placement budget envelopes, headcount as data (seats added, paused,
  re-opened, retired without code);
- **staffing** (Director request with Stage 10 evidence → CEO synthesis → Founder decision, or a capped,
  revocable Founder → CEO delegation → a CANDIDATE hire that the Academy still activates);
- **work delegation** down the reporting line, cross-Department support, refusal / clarification /
  escalation handoffs, with bounded depth and no cycles — work delegation never delegates authority;
- the dynamic **Review Pool** (reviewers qualified by Academy certification, Gold cases and calibration,
  admitted by the Founder — not a Department), review designed before execution and bound to the exact
  output or action, R2 = independent review, R3 = review AND Founder approval, R4 Founder-only,
  conflicts, escalations, Quality Holds and Independent Oversight;
- **P-07**: a deployment that charged a failed attempt is not routed to again for the same Work Item.

Title ≠ Authority throughout: every organizational act needs an explicit grant and the seat. Details:
`docs/C4_IMPLEMENTATION_REPORT.md`, decisions D-C4-01 onward. Still out of scope: the Founder Command
Center and Founder ↔ CEO conversation (C5, since closed), the improvement engine (C6), APP-OPS (C7) and any
QANDEEL App integration.

**C6 (implementation candidate, not closed) adds the Company Improvement Engine** — so QANDEEL can prove it is
getting better, not merely remember more. It extends the C1–C5 mechanisms and duplicates none of them:
- a QANDEEL-owned, provider-independent **Eval Registry**: versioned definitions (dimensions, required
  evidence, evaluator kind, minimum evidence, reference cases) that are activated only after the evaluator
  passes its own calibration — known-good passes, known-bad fails, ambiguous evidence stays unknown, a
  non-employee cause is not blamed, a valid creative path is not penalized;
- **Completed ≠ Reviewed ≠ Outcome Verified**: a governed outcome verification (evidence classes and
  references) is the only way to `OUTCOME_VERIFIED`; a qualified outcome is reviewed AND verified; external
  outcomes are stated unavailable until C7 provides a governed source;
- **operational judgment without a Founder bottleneck (C6-R1)**: where a Work Item's Review Plan says
  `REVIEW_POOL` (never R4, never beside a FOUNDER key), its independent qualified reviewers verify the outcome
  from their own cited judgments (a disagreement is never averaged) and one independent pool judge validates an
  attribution or a lesson from its own governed, pre-budgeted review run; uncertainty escalates to the Founder,
  who stays the exception authority. Verification authority is never execution authority: no judgment grants,
  funds, approves, routes or raises a risk ceiling, R3 still needs the Founder's approval and R4 stays the Founder's alone;
- evidence-based **evaluation** of each Work Item from its real lineage (reviews, runs, tools, context, usage,
  interventions); activity is observability only; insufficient or conflicting evidence stays so;
- **causal attribution** (Employee judgement, model, tool, context retrieval, workflow, provider, requirement,
  external dependency, mixed, unknown), proposed from evidence and validated independently of the subject
  Employee; a validated non-employee cause never counts against the Employee;
- a multi-dimensional **Performance Profile** (outcome, quality, judgement, efficiency, initiative, learning
  velocity, independence, system contribution) with sample, confidence, trend, capability and regression —
  **no universal score, rank or leaderboard**; `READY_FOR_GREATER_RESPONSIBILITY_REVIEW` is evidence for a
  human decision, never a promotion; **cost per qualified outcome** instead of "cheapest";
- **learning closure** over the C3 lesson lifecycle: reflection is a hypothesis (validated only on
  independent evidence), mistake lessons, successful patterns (candidate-first, shared only after verified
  reuse), near-miss warnings, systemic findings when failures repeat across Employees (double-loop) or when an
  Employee's reflected systemic problem is confirmed by a validated system cause (traceable to that Employee
  and credited to their System Contribution only once the Founder validates it — credit, never authority), learning
  interventions whose effect is judged on LATER comparable evidence (training completed ≠ improvement), a
  bounded retraining loop that escalates instead of repeating, and the failure → regression / Gold case path
  bound to hidden Academy holdouts;
- **reports with typed claims** (FACT / ASSESSMENT / TREND / RECOMMENDATION, each judgement with evidence and
  uncertainty): Daily Company Brief, Weekly Operating Review, Monthly People & Capability Review, on-demand
  inspection (Company, Department, Employee, Goal, Work Item) over the existing Founder API and command
  channel; only material exceptions join Founder Attention;
- **resilience (Stage 15)**: recovery objectives by criticality, an encrypted **portable package** (database +
  manifest + artifact objects, scrypt → AES-256-GCM, passphrase never stored) written to a destination outside
  the workspace with an honest failure-domain label, generational retention, restore drills, clean-device
  restore (sessions revoked, credential references to re-key, uncertain effects still held), and update safety
  (Preflight → Backup → Rehearse → Migrate → Verify → Activate, `UPDATE_HOLD`, bounded rollback).

Details: `docs/C6_IMPLEMENTATION_REPORT.md`, decisions D-C6-01 onward.

**C7-A (closed) adds the Company's first trustworthy connection to real-world evidence**,
inside the existing C6 engine — never beside it:
- a **governed source registry**: provider-neutral sources (the App's operational stream, or an outcome family —
  search, web, store, business, campaign, social, App health) under a closed, versioned, digest-pinned contract;
  DRAFT until the Founder activates it through the governed confirmation; SUSPEND fails closed; RETIRE is final;
- a **content-free intake seam** (`ExternalEvidenceStore.ingest`) that App-side integration and L1 can call later:
  allowlist-first validation, refusal by reason code (private content, credentials, raw payloads, bags, free text and
  secrets are refused and never stored, logged or echoed), idempotency by (source, producer event id), conflicting
  replays recorded and never applied, event time ≠ receipt time; a user-scoped diagnostic's pseudonym is never stored;
- **explicit Founder bindings** of an accepted record to a Work Item or Goal — outcome evidence (outcome lane only) or
  an external dependency failure; evidence is never a verdict;
- **C6 integration**: `EXTERNAL_OUTCOME` is runtime truth (no static flag); the Founder or, where the plan delegates,
  the Review Pool verifies outcomes on usable governed evidence; the evaluator, attribution (an external dependency is
  a non-employee cause), reports (unavailable / nothing relevant / cited evidence) and inspection cite canonical records;
- **contracts held by the datastore**: the release's contract catalogue is SQLite state, so a direct write cannot create
  evidence of another family, type, domain, unit, scope or field shape than the source's registered contract allows;
- **late integrity conflicts**: a conflicting replay contests every verification that rested on the record — it stays
  history, leaves current C6 truth (evaluation, profile, economics, reports) and reaches the Founder, who upholds,
  replaces (on usable evidence) or retracts it through the governed confirmation.

C7-A has no transport, listener, SDK, control plane, publishing or Pilot objective engine. Details:
`docs/C7A_IMPLEMENTATION_REPORT.md`, decisions D-C7A-01 onward; closure: `docs/C7A_CLOSURE_RECORD.md`.

**C7-B (closed) adds the Company's governed desired-control plane toward the App**,
inside the existing governance — never beside it:
- exactly the **seven approved control families** (Feature Flags, Kill Switch, Maintenance Mode, Rollout Control,
  Minimum Supported Version, Approved Remote Configuration, Model / Provider Route Hold), each with its own closed
  scope kinds and one typed value; no free text, expression, script, query, prompt or URL — no generic remote execution;
- every issue / change / release is **R3**: an Employee holding the persistent **App Operations & Release Lead** seat
  (a new vacant Product seat under the Product Director, distinct from the App Store Release & Reputation Lead) with an
  explicit Founder-created grant proposes it from a governed run; the Review Pool reviews exactly that act; the Founder
  approves it through the existing approval engine and governed confirmation; only then is it issued;
- **immutable, versioned desired state**: series, revisions with compare-and-swap, RELEASE as a new revision, all held
  by datastore triggers; the only Company state is ISSUED — nothing claims what the App applied;
- the **Approved Remote Configuration register is empty** (fails closed until a controlled release approves a family);
  a **Route Hold only holds** (never selects, forces or chooses FAST / DEEP);
- a deterministic read seam of the Company-issued controls for later App-side integration (no transport), and bounded
  refusal counters that close the Company-side storage amplification of C7-A refusals.

C7-B has no transport, App consumer, signing, credential, applied state or App change. Details:
`docs/C7B_IMPLEMENTATION_REPORT.md`, decisions D-C7B-01 onward; closure: `docs/C7B_CLOSURE_RECORD.md`.

**C7-C (closed) adds Pilot instrumentation** — a Founder-decided context over the existing
Company, never a second engine:
- a durable **Pilot** (`TRAINING_INTERNAL` or `CONTROLLED_REAL`) with a forward-only lifecycle DRAFT → BRIEFING →
  READY → ACTIVE → REVIEWING → COMPLETED (or STOPPED), every step an explicit, confirmed Founder act; it grants no budget,
  tool, role or authority, and no metric or message moves it;
- **conversation first**: the Founder briefs the CEO in an ordinary C5 thread; READY needs a governed CEO reply to a
  Founder request (silence is never agreement); ACTIVE needs a Founder-approved Company Goal with success criteria;
- an **Evidence Board** derived live from Goals / Work / Review, the C6 engine (the eight-dimension profile, attribution,
  learning, cost per qualified outcome), C7-A real-world evidence and C7-B issued controls (context only): outcome and
  trace, appropriate autonomy through JUDGMENT + INDEPENDENCE, and an advisory readiness checklist — no score, rank or
  leaderboard; internal training is never market success.

C7-C builds no website, publishing, connector or transport (that is C7-D, Digital Presence Creation & Operations).
Details: `docs/C7C_IMPLEMENTATION_REPORT.md`, decisions D-C7C-01 onward; closure: `docs/C7C_CLOSURE_RECORD.md`.

**C7-D (closed) adds Digital Presence Creation & Operations capability** — the Company can
later build and operate QANDEEL's digital presence itself; C7-D does not build the website:
- an internal **Digital Workshop**: Digital Projects, working → FINALIZED revisions (immutable, deterministic manifest hash)
  over the Artifact Store (file content never in SQLite), typed authoring actions of one closed Company-native Tool — no
  shell, filesystem or HTTP tool — that Employees use with explicit grants and **no Founder approval**;
- an **internal Preview** on its own loopback site (127.0.0.2, sandboxed opaque origin, no network, no cookies, noindex),
  never a publication; a deterministic **SEO readiness lint** with findings only, never a score;
- exact **Release Candidates** and **promotions**: every external act is an R3 tool action through the existing Tool
  Executor — independent Review Pool review, the Founder's approval of exactly its arguments (candidate + manifest hash +
  target), idempotent driver, reconciliation on an unknown outcome; export ≠ production merge ≠ another post;
- the first external adapter, **GitHub** (installation token per call, one repository, five least-privilege permissions,
  closed endpoint allowlist, exact-tree export, exact-head merge with no bypass), and provider-neutral **hosting / CMS and
  social seams** with no provider selected; publication is never market success (real outcomes come only through C7-A).

Details: `docs/C7D_IMPLEMENTATION_REPORT.md`, decisions D-C7D-01 onward; closure: `docs/C7D_CLOSURE_RECORD.md`.

**L1-01 (closed; `docs/L1_01_CLOSURE_RECORD.md`) brings up the Founder-selected live provider** — DeepSeek-V4.1-Flash
(`deepseek-flash`) — through the EXISTING governed Model Runtime, never beside it:
- a **Windows user-scoped secret vault** (`@qandeel-company/secret-vault`): opaque `vault:<name>` references everywhere,
  values protected with built-in Windows DPAPI (CurrentUser) through the signed PowerShell host and stored under the
  Founder user's local application data — never in Git, SQLite, a workspace, a backup, an artifact, a log, a prompt or a
  command line; `qandeel-vault set <name>` prompts without echo and refuses a secret argument; CI uses an in-memory vault;
- the **DeepSeek adapter** (`@qandeel-company/model-providers`) behind the unchanged `ProviderAdapter` contract: one
  fixed origin, a closed endpoint allowlist, no redirects, bounded non-streaming Chat Completions in JSON mode, no provider
  tools, E1–E4 → thinking none / low / high / max, the credential resolved privately per call, final content + normalized
  usage only — no chain-of-thought, header, bearer or raw body ever returned, logged or persisted; failures normalized to
  the C2 taxonomy with no retry inside the adapter;
- **alias drift fails closed**: `deepseek-flash` is checked against the qualified public identity (DeepSeek-V4.1-Flash)
  before the first call and after each identity TTL; a drifted alias holds the deployment (MODEL_DEPRECATED) and
  provisioning needs a fresh MATCH check (content-free, append-only `model_identity_checks`);
- **truthful provider billing**: an immutable price card may carry a cached-input rate and an off-peak schedule (UTC
  windows, weekdays, published holidays, basis source + date); reservations stay the peak, all-cache-miss worst case;
  settlement records the actual bill (cache hits, band) beside the governed economic cost; historical usage never changes;
- **governed provisioning**: a release-pinned provider profile (provider, model identity, E1–E4 deployments with
  conservative Company-side limits, pricing basis, D2 egress, LIMITED_PRODUCTION, pilot route policies) registered through
  the canonical catalog APIs by the Founder's structured `PROVIDER_PROVISION` confirmation, with the exact cap visible
  first; the stable context prefix now tells a real model how to answer the Founder (MESSAGE, then FINAL).

L1-01 adds no second provider, no DeepSeek Pro fallback, no provider tools, no voice, no APP-OPS transport and no
unlimited budget; D3 / D4 never leave the machine. Details: `docs/L1_01_IMPLEMENTATION_REPORT.md`, decisions D-L1-01
onward.
| Package | Role |
|---|---|
| `@qandeel-company/domain` | Pure contracts: IDs, UTC clock, state machines, retry policy, processor contract |
| `@qandeel-company/governance` | C2 pure policy kernel: Employee lifecycle, R0–R4 authority, `E0..E4` / `D0..D4`, Router Policy, checked economics, provider / tool contracts, typed proposals; C4 organization, delegation and review rules; the C7-A intake kernel (closed contracts, allowlist, privacy refusal, source lifecycle); the C7-B control kernel (seven closed families, typed scopes / values, empty Remote Configuration register, negative-only Route Hold, R3 control acts) |
| `@qandeel-company/mind` | C3 pure kernel: Memory Write Policy, deterministic retrieval and context planning, compaction, Skill pipeline / licensing / inspection, capability evaluation, Academy rules; C6 evaluation, attribution, Performance Profile, learning closure and report semantics |
| `@qandeel-company/storage` | Workspace, SQLite/WAL adapter (the only `node:sqlite` user), migrations, repositories, Artifact Store, backup; C4 Organization and Review stores; C5 Founder stores; C6 Improvement store and resilience (portable packages, retention, drills, update safety); the C7-A External Evidence store (governed sources, intake, bindings, bounded refusal counters); the C7-B App Control store (proposals, issued revisions, the export of Company-issued desired controls); the C7-C Pilot store (lifecycle, bindings, the derived Evidence Board) |
| `@qandeel-company/secret-vault` | L1-01 secret boundary: `vault:<name>` references resolved to values only inside a governed executor's private callback; the Windows DPAPI (CurrentUser) vault through the signed PowerShell host (the one reviewed process path), the in-memory vault for CI, the no-echo `qandeel-vault` command |
| `@qandeel-company/model-providers` | L1-01 real provider adapters behind the C2 `ProviderAdapter` contract: the DeepSeek adapter (fixed origin, bounded, E1–E4 thinking profiles, alias identity check, no chain-of-thought), its fake transport for CI, the release-pinned DeepSeek V4.1 Flash provisioning profile and versioned pricing basis; called only by the governed Model Runtime |
| `@qandeel-company/tool-drivers` | C7-D governed external Tool drivers: the GitHub code-host promotion adapter behind one fixed-host HTTPS transport (and a deterministic fake GitHub for CI), the provider-neutral hosting / CMS and social publication seams; reached only through the Tool Executor |
| `@qandeel-company/runtime` | Runtime Supervisor, bounded worker pool, recovery, health, CLI; C2 governed Model Runtime, Tool Executor, `c2.employee-task` loop, deterministic fakes; C3 Context Assembler and memory-proposal path |
| `@qandeel-company/bootstrap-contract` | C0 toolchain proof (unchanged) |

**The runtime workspace is separate from Git.** Live Company state
(`state/company.sqlite3`, `artifacts/`, `backups/`, `runtime/`) lives in a workspace directory that
you pass with `--workspace`. It is never inside this checkout and never on a network/mapped drive.
No Founder path is built into the code.

**Cloud sessions work from this repository's authority, not from hidden local context.** The
detailed Stage 0–17 authority is in `docs/authority/company-architecture/`. The one exception is the
Stage 16 source artifact, which is missing and recorded as missing.

## Authority — read before changing anything

1. `docs/authority/COMPANY_CANONICAL_BASELINE.md` — what the Company is and must remain (summary).
2. `docs/authority/company-architecture/README.md` — the index to the detailed canonical Stage
   authority, with provenance in `AUTHORITY_IMPORT_MANIFEST.md`. Where it holds detail, it governs
   over the summary.
3. `docs/authority/IMPLEMENTATION_AUTHORITY_RULES.md` — who decides what; how work is merged.
4. `docs/architecture/IMPLEMENTATION_MAP.md` — work-package sequencing (not evidence of
   implementation).
5. `docs/architecture/BOUNDARIES.md` — boundaries that code must not cross.
6. `docs/architecture/DECISION_LOG.md` — engineering decisions and why.
7. `docs/environment/L0_READINESS_DECISION.md` — Founder-host constraints.

## Development model

**Cloud-first build / local-final validation and operation:**
Claude Cloud session → GitHub branch / PR → local fetch or clone → local validation on the
Founder Windows host. Cloud sessions are disposable; nothing canonical lives in them.

## Prerequisites

- Node.js **24** LTS (`.nvmrc`), with its bundled npm 11. Other majors fail `npm ci`
  (`engine-strict`).
- Git. On the Founder host, use GitHub Desktop's bundled Git for HTTPS (see Windows notes).
- No global npm packages, native build tools, databases or services are needed.

## Setup and scripts

```bash
npm ci
npm run ci
```

`npm run ci` is the **proportional** local validation (D-D0-01; same as `npm run validate:affected`). It prints the
validation plan from the one canonical impact map (`scripts/ci/impact-map.mjs`), then runs only the impacted boundary.
It never runs the historical C1→L1 mutation universe. A FULL-classified change (shared foundations, toolchain, CI,
unknown paths…) gets a local preflight, and its FULL continuity proof runs on GitHub. Options: `-- --base <rev>`,
`-- --head <rev>`, `-- --plan-only`, `-- --with-mutation` (affected mode only: the plan's own families).

| Script | What it does |
|---|---|
| `npm run build` | Compiles every workspace with `tsc` into its `dist/` |
| `npm run typecheck` | Type-checks every workspace without emitting |
| `npm run lint` | ESLint over the repository, zero warnings allowed |
| `npm test` | Builds and runs every workspace's `node:test` suite. It includes real-SQLite, multi-process and fault-injection tests, and refuses zero, skipped or todo tests |
| `npm run c1:integration` | Multi-process storage proofs + runtime integration tests (after a build) |
| `npm run c1:faults` | The process-kill fault matrix (after a build) |
| `npm run c1:acceptance -- --workspace <dir>` | C1 local acceptance in a disposable directory (below) |
| `npm run c2:mutation` | Removes 19 C2 authority / budget / tool / routing gates from the build; their proof tests must fail (after a build) |
| `npm run c2:acceptance -- --workspace <dir>` | C2 local acceptance in a disposable directory (below) |
| `npm run c3:mutation` | Removes 40 C3 memory / context / skill / academy / Founder-decision gates from the build; their proof tests must fail (after a build) |
| `npm run c3:acceptance -- --workspace <dir>` | C3 local acceptance in a disposable directory (below) |
| `npm run c4:mutation` | Removes 25 C4 organization / delegation / review / P-07 gates from the build; their proof tests must fail (after a build). `-- --shard i/n` runs a disjoint slice |
| `npm run c4:acceptance -- --workspace <dir>` | C4 local acceptance in a disposable directory (below) |
| `npm run c7a:mutation` | Removes 48 C7-A intake / privacy / source-governance / usable-evidence / C6-seam / contest / datastore-contract gates from the build (a datastore gate from the migration, re-pinned for that run only); their proof tests must fail (after a build). `-- --shard i/n` runs a disjoint slice; `-- --only id,id` a local focus |
| `npm run c7b:mutation` | Removes 33 C7-B control-plane gates (seven-family catalogue, R3 seat / grant / review / Founder approval, exact-act binding, the revision law, the datastore family / scope / value contract, ISSUED-only state, negative-only Route Hold, empty Remote Configuration register, no generic execution, content-free outbox, refusal coalescing) from the build (a datastore gate from the migration, re-pinned for that run only); their proof tests must fail (after a build). `-- --shard i/n` runs a disjoint slice; `-- --only id,id` a local focus |
| `npm run c7c:mutation` | Removes 27 C7-C Pilot gates (READY without briefing evidence or on a briefing from before the Pilot, ACTIVE without an active root goal, a message read as authority, terminal revival, mode change, Founder bypass, repeated steps, duplicate linkage, activity as performance, aggregation, attribution / review bypass, training as improvement, zero-qualified efficiency, ledger bypass, contested or training market claims, an issued control as an outcome, audit content) from the build (a datastore gate from the migration, re-pinned for that run only); their proof tests must fail (after a build). `-- --shard i/n` / `-- --only id,id` as above |
| `npm run l1:mutation` | Removes 27 L1-01 gates (plaintext vault, a secret on the command line, an arbitrary provider URL / redirect / endpoint, the E4 thinking mapping, the top-level reasoning_effort wire contract (nested or unlisted), the ProviderRequest leaking into the body, the recorded-message run end, 401 retried, 402 transient, a timeout marked not-sent, cache hits billed as misses, off-peak / holidays ignored, a reservation below the worst case, alias drift ignored, D3 egress…) from the build; their proof tests must fail (after a build). `-- --only id,id` a local focus |
| `npm run l1:smoke -- --workspace <dir>` | **Founder host only, never CI:** the L1-01 live smoke through the real governed runtime and the real DeepSeek adapter (needs `vault:deepseek-company`, the network and a tiny bounded spend; see below) |
| `npm run verify` | Repository-contract verifier (`scripts/verify-bootstrap.mjs`) |
| `npm run ci` / `npm run validate:affected` | Proportional validation: print the plan (docs / affected / full) from the canonical impact map, then run only the impacted boundary — never the serial historical mutation universe (D-D0-01) |
| `npm run validate:plan` | Print the validation plan for the current change and run nothing |
| `npm run desktop:bundle -- [--out <dir>]` | D1: compose the Desktop bundle (build → canonical release → pinned private Node 24 win-x64 → icon → `qandeel.desktop-bundle/v1`) in a directory outside the checkout |
| `npm run desktop:setup -- [--out <dir>] [--class ENGINEERING\|FOUNDER-RC]` | D1: the bundle, then `QANDEEL-COMPANY-Setup.exe` with the pinned Inno Setup, its SHA-256 and verification record (signed only when a signing credential is configured, D-D1-06). **Windows build machines / CI only** |
| `npm run desktop:verify -- --dist <dir>` | D1: re-verify a built Setup (SHA-256, Authenticode status, source → release → bundle identity) |
| `npm run desktop:proof -- --workspace <dir>` | D1: the focused Desktop proof in a disposable profile (packaging, install, runtime, update, rollback, repair, uninstall, reinstall, detached from the checkout) |
| `npm run desktop:e2e -- --workspace <dir>` | D1: the real Setup.exe end to end — **disposable Windows CI runner only** (refuses anywhere QANDEEL data exists) |

**GitHub CI** classifies each pull request with the same map. `docs` runs build + verifier. `affected` runs the boundary's
static checks, tests, acceptance and its mutation families (Windows mandatory). `full` runs every test, every mutation
family (sharded, parity on Windows and Ubuntu), every acceptance and the verifier. The required status is `quality-gate`.
A merge whose tree a green `full` or `affected` run proved takes `fast-integrity`. **A Desktop release candidate needs
one green FULL GitHub gate on its exact tree**, from a FULL pull request run or a manual `workflow_dispatch` run.

### C1 local acceptance (Founder host)

```bash
npm ci
npm run build
npm run c1:acceptance -- --workspace "D:\QANDEEL-C1-ACCEPTANCE\run-1"
```

- **Choose a directory.** Pick any new or empty directory that is outside every Git checkout; the
  path above is only an example.
- **What it proves:** workspace creation, WAL, migrations, the Work Item lifecycle, the atomic claim,
  crash/restart recovery (a real child process is killed), artifact hashing, online backup, isolated
  verification and restore dry start, and health/readiness.
- **Result and cleanup:** it prints `C1 LOCAL ACCEPTANCE — PASS`, then deletes only the directory it
  created. Pass `--keep` to keep it.
- **What it needs:** no credentials, no provider keys, no network.

### C2 local acceptance (Founder host)

```bash
npm run c2:acceptance -- --workspace "D:\QANDEEL-C2-ACCEPTANCE\run-1"
```

- **What it proves:**
  - production fail-closed first: without the authenticated Founder surface (C5), Founder
    authority cannot be created or exercised by presenting a reference, and the CLI has no
    Founder write command;
  - then, through the **test-only** Founder seam (loaded only under `--conditions=qandeel-test`,
    never a product path): the Founder principal, a department, activation refused without C3
    certification, an Employee set `ACTIVE` by the seam, and D3 external egress refused;
  - the model catalog, Router Policy, tools, grants and budgets;
  - zero provider calls while idle;
  - a governed run with a permitted R1 tool;
  - a D4 context never reaching a lower-ceiling tool;
  - an R3 tool parked for approval that the CLI cannot approve, then executed exactly once after a
    seam approval;
  - a hard budget refusal before any provider call;
  - coherent accounting, health and the read-only CLI.
- **Result and cleanup:** it prints `C2 LOCAL ACCEPTANCE — PASS` and deletes only what it created.
- **What it needs:** no credentials, no provider keys, no network.

### C3 local acceptance (Founder host)

```bash
npm run c3:acceptance -- --workspace "D:\QANDEEL-C3-ACCEPTANCE\run-1"
```

- **What it proves:**
  - production fail-closed first: no C3 authority act (canonical truth, knowledge, skill pipeline,
    Academy, activation) without the authenticated Founder surface, and no C3 write command on the CLI;
  - then, through the **test-only** Founder seam: the Skill pipeline (an unlicensed skill rejected,
    a paid dependency held for acknowledgement, one skill approved), a Role Skill Blueprint and
    Academy program, and a trainee who is **never** activated by the seam;
  - zero provider calls and zero context assemblies while idle;
  - the Academy path executed by the real runtime in constrained mode (no external action), through
    the governed Context Assembler;
  - certification that does not activate, an activation request production cannot approve, then
    a seam approval that re-checks the evidence and activates;
  - a model-proposed memory stored by policy (capped, attributed), manifest-bound reservations, and
    the memory and pinned skill recalled in a later run;
  - a durable capability gap that parks work without a model call and never re-routes it;
  - content-free health and read-only CLI.
- **Result and cleanup:** it prints `C3 LOCAL ACCEPTANCE — PASS` and deletes only what it created.
- **What it needs:** no credentials, no provider keys, no network.

### C4 local acceptance (Founder host)

```bash
npm run c4:acceptance -- --workspace "D:\QANDEEL-C4-ACCEPTANCE\run-1"
```

- **What it proves:**
  - production fail-closed first: no organization / delegation / Review Pool authority act without the
    authenticated Founder surface, and no C4 write command on the CLI;
  - the canonical skeleton (five Departments, a company-scoped CEO seat, five Director seats), vacant;
  - then, through the **test-only** Founder seam: a company-scoped CEO, a Director and a report placed;
    headcount as data; acting coverage that ends by time;
  - a reviewer certified by the Academy through real runs, calibrated on real shadow reviews and
    promoted on evidence;
  - staffing through Employee runs: Director request → CEO recommendation → delegated decision → a
    CANDIDATE hire;
  - work delegation with the delegator parked at zero tokens until the delegate finishes;
  - output review by the reviewer's own run; R3 = review AND Founder approval, executed exactly once;
  - P-07 across runs; restart durability; content-free health and read-only CLI.
- **Result and cleanup:** it prints `C4 LOCAL ACCEPTANCE — PASS` and deletes only what it created.
- **What it needs:** no credentials, no provider keys, no network.

### C5 local acceptance (Founder host)

```bash
npm run c5:acceptance -- --workspace "D:\QANDEEL-C5-ACCEPTANCE\run-1"
```

- **What it proves:**
  - production fail-closed first: a Founder reference is not authentication, a garbage session is refused,
    the launcher CLI has no write command, a launch token is single-use and yields a session whose scope
    arms Founder authority for exactly one synchronous call;
  - then, through the **test-only** seam standing in for the launch-token session while seeding: a
    representative organization (CEO, Directors, managers, specialists, a vacant Director seat covered
    ACTING, vacant specialist seats), live work (running, blocked, awaiting Founder approval, delegated),
    Goals with Goal → Work links, a Founder ↔ CEO thread answered by the CEO's own governed run, a CEO
    brief in the Founder Communication Standard;
  - the Company Universe projection (Founder, CEO, five Departments, truthful seats, live-only relations,
    Goal traceability), deterministic and time-correct;
  - Founder Attention lanes (Needs Me / CEO Briefs; routine work and plain FYIs excluded; no storm);
  - the governed confirmation boundary over real loopback HTTP: natural language → structured preview →
    explicit confirmation; forged CSRF, wrong fingerprint and a foreign Host are refused;
  - conversation ≠ authority; restart durability with every session revoked; content-free logs / health.
- **Result and cleanup:** it prints `C5 LOCAL ACCEPTANCE — PASS` and deletes only what it created.
- **What it needs:** no credentials, no provider keys, no network.

### C6 local acceptance (Founder host)

```bash
npm run c6:acceptance -- --workspace "D:\QANDEEL-C6-ACCEPTANCE\run-1"
```

- **What it proves (real runtime, real SQLite, deterministic fake provider and tools):** the Eval Registry refuses
  an uncalibrated grader; Goal-linked work executed by the governed runtime, reviewed by an Academy-certified
  reviewer's own run and outcome-verified is a qualified outcome while COMPLETED alone is not; a real tool
  failure is attributed to the tool, not the Employee; a reflection is refused validation until an independent
  attribution exists; a validated lesson → targeted retraining → NOT_YET_TESTED until later comparable work
  proves IMPROVEMENT_OBSERVED; a successful pattern stays candidate-first; repeated failures across Employees
  become a systemic finding in Founder Attention; a real failure becomes a hidden Gold case; reports carry typed
  claims and no score; cost per qualified outcome; the C5 change-signalling contract holds; an encrypted
  portable package (honestly labelled SAME_VOLUME, then attested off-device), tamper / wrong-key refusal,
  retention, a restore drill, a clean-device restore (identities, work, evaluation, attribution, artifacts,
  audit; sessions revoked; re-key list) whose restarted runtime never repeats an uncertain external effect;
  a real v9 → v10 update activated, then rolled back into `UPDATE_HOLD`.
- **What it does NOT prove:** a physical laptop loss, a real replacement device, real cloud storage or real App
  telemetry (L1 / Controlled Pilots / C7).
- **Result and cleanup:** it prints `C6 LOCAL ACCEPTANCE — PASS` and deletes only what it created.

### C6 recovery (operator notes)

- The recovery passphrase is **your recovery material**: keep it outside the laptop (for example on paper in a
  safe place). It is read from `QANDEEL_RECOVERY_PASSPHRASE` and never stored, logged or packaged; without it a
  package cannot be opened.
- `portable-backup --destination <dir> [--attest-off-device]` writes a sealed package to a directory outside the
  workspace. Only an external drive or a mounted encrypted remote folder is off-device: a directory on the
  laptop's own volume is reported `SAME_VOLUME` and never satisfies the off-device objective.
- `restore-portable --workspace <new empty dir> --package <file>` restores on a clean environment; then start the
  runtime, re-key the reported credential references, reconcile any held uncertain effects, and sign in again
  (every old Founder session is revoked). The target is held (`RESTORE_IN_PROGRESS`) from its first byte until the
  controlled restore commits: nothing starts, inspects or clears it meanwhile. If the restore is interrupted,
  `restore-status` shows the attempt and phase, and running `restore-portable` again with the same package resumes it
  (a committed attempt is only finalized, anything else is redone from the package); another package needs
  `--discard-partial-restore`.
- `safe-upgrade` performs a schema update with a pre-update snapshot; on failure the workspace enters
  `UPDATE_HOLD`, which every start refuses until `clear-update-hold --reason <code>`.
### L1-01 live provider on the Founder host (DeepSeek V4.1 Flash)

The key never enters Claude, the chat, a file, Git, a config, a command-line argument, SQLite, a workspace, a prompt, a
log or an artifact. It is typed once, at a hidden prompt, into the Windows user vault:

```bash
node packages/secret-vault/dist/src/cli.js set deepseek-company
```

(`--replace` to overwrite; `has` / `list` / `remove` never show a value.) Then, on an initialized workspace:

```bash
node packages/command-center/dist/src/cli.js provider-check --workspace "D:\QANDEEL-COMPANY\workspace" --provider deepseek --probe
```

records the content-free identity check of the `deepseek-flash` alias (it must still name `DeepSeek-V4.1-Flash`) and,
with `--probe`, one tiny bounded call's metering. `serve --provider deepseek` starts the Founder surface with the real
adapter behind the vault and registers the release-pinned profile; `show providers` in the palette offers the governed
`PROVIDER_PROVISION` preview (deployments, peak reservation rates, egress ceiling and the exact first cap are shown before
you confirm). `npm run l1:smoke -- --workspace <disposable dir>` is the first-bring-up proof through the real runtime:
identities seeded through the test-only seam (as every acceptance does), the real adapter, a Founder → CEO message in the
canonical thread and the CEO's governed reply, with content-free usage / band / bill proof and a scan that neither the
key nor any thinking text was persisted. No live key is ever used in CI.

### C5 Founder Command Center (Tree of Light)

After `npm run build`:

```bash
node packages/command-center/dist/src/cli.js serve --workspace "D:\QANDEEL-COMPANY\workspace"
```

It starts the Company runtime and the loopback-only Founder surface in one process and prints a launch URL
(`http://127.0.0.1:<port>/launch#<token>`; single-use, 90 seconds). Open it in Edge or Chrome on the same
machine: the browser exchanges the token for a session (hashed at rest, HttpOnly, SameSite=Strict) and lands
in **Company Live** — the Founder at the top, the CEO beneath on one leadership trunk, the five Departments
as columns branching below (each led by its Director, its people inside in rank order, vacant seats and acting
cover shown truthfully), the goals along the bottom as the strategic direction, gold execution lines from
each Department to the goals its work serves, and what needs the Founder beside the Founder. The surface is
DOM and SVG (no WebGL, no vendor library). The application is English; company content (names, objectives,
messages) renders as written, Arabic right-to-left inside its own block. `Ctrl+K` opens the command palette
(Arabic or English): read commands change focus; a mutating
instruction becomes a governed preview that the Founder confirms explicitly. `node … cli.js launch --workspace
<dir> --port <port>` mints a fresh launch URL for a running surface. There is no approve / reject / register
command on any CLI: a Founder reference is not authentication.

- **Visual proof package (from the real UI):** `npm run c5:visual-proof -- --workspace <disposable dir> --out <dir>`
  seeds a representative company, drives a headless Edge / Chrome through the DevTools Protocol (no
  dependency) and writes thirteen scenario frames (Company Live, Employee Focus, Goal Focus, Founder Attention
  compact and opened, the Founder ↔ CEO and Founder ↔ Employee conversations with Arabic and English messages,
  governed preview and confirmation, Historical Focus, reduced motion and a really seeded scale frame) plus two
  close-ups, a short walkthrough MP4 (encoded offline in the browser) and a manifest; `--minimal` captures only
  the frames a presentation-only correction is judged on (no walkthrough, no scale frame);
  `--before <previous proof dir>` adds a before/after board. `npm run c5:spike -- --workspace <dir>` runs only
  the technical smoke checks (the company surface renders — spine, five columns, goals, execution lines;
  English application with content as written; selection / focus / return; the line layer bounded across
  redraws; the surface idle after a selection and return (no refresh storm); reduced-motion parity,
  state-aware of the runner's own preference; no external asset). Every
  DevTools command the harness sends is bounded (`QANDEEL_CDP_TIMEOUT_MS`, default 20 s) and a command the
  browser never answers fails naming the method, the helper and the step, with the browser's process tree and
  log tail; every step records the timing of each helper call, and the browser's product and GPU backend are
  recorded at start. The browser renders without a GPU process (`--disable-gpu`: the surface is DOM + SVG and
  the encoder a 2D canvas; a SwiftShader GPU process saturated the Windows runner); `QANDEEL_BROWSER_GPU=swiftshader`
  restores that path for comparison, and `QANDEEL_BROWSER_ARGS` passes extra browser flags to reproduce a
  runner locally (for example `--force-prefers-reduced-motion`).

### Engineering CLI

After `npm run build`: `node packages/runtime/dist/src/cli.js <command> --workspace <dir>`.

| Command | What it does |
|---|---|
| `init` | Creates and validates the workspace and runs the migrations |
| `start` | Runs the Runtime Supervisor until Ctrl+C |
| `health` | Read-only inspection |
| `submit --kind c1.steps` | Submits deterministic work |
| `cancel --work-item <id>` | Cancels a Work Item |
| `backup` | Online backup |
| `verify-backup --backup <id>` | Verifies a backup in isolation |
| `restore-check --backup <id> --target <empty dir>` | Isolated restore dry start |
| `verify-artifacts` | Re-hashes every artifact object |
| `governance` | Read-only C2 governance health: employees, holds, budgets, approvals, reconciliation |
| `approvals` | Lists pending approvals (IDs, risk, action codes; no content) |
| `mind` | Read-only C3 health: memory / knowledge / context / skills / academy counts |
| `capability-gaps` | Open capability gaps (Work Item, Employee, missing codes) |
| `context-manifest --manifest <id>` | One context manifest: selected / rejected IDs, versions, hashes, classes (no content) |
| `organization` | Read-only C4 organization: Departments, seats and holders, executive queues, health (no evidence text) |
| `reviews` | Read-only C4 reviews: live requests, conflicts, holds, Review Pool health (no rationale or instructions) |
| `improvement` | Read-only C6 health: evaluations, attributions, learning, systemic findings, recovery status |
| `report --cadence <DAILY\|WEEKLY\|MONTHLY>` | Generates (idempotently) and prints a report's typed claims (codes, ids, counts) |
| `external` | Read-only C7-A: external-outcome availability and governed source health (ids, states, counts; no record content, no intake / register / bind command) |
| `portable-backup --destination <dir> [--attest-off-device]` | Encrypted portable package outside the workspace (`QANDEEL_RECOVERY_PASSPHRASE`) |
| `restore-portable --package <file> [--discard-partial-restore]` | Clean-environment restore into `--workspace` (a new, empty directory, or one holding an interrupted restore to resume) |
| `restore-status` | The target's hold and live-restore marker (attempt, package, phase, history); never opens the database |
| `restore-drill` | Isolated restore drill of the newest live generation (recorded) |
| `prune-backups [--keep-last n --daily n --weekly n --monthly n]` | Generational retention (never the last generation) |
| `safe-upgrade` / `clear-update-hold --reason <code>` / `rollback-update --update <id>` | Update safety and `UPDATE_HOLD` |
The CLI has no Founder write command: a Founder reference typed on a command line is not
authentication. Founder authority arrives with the authenticated Founder surface (C5), and until
then R3 work stays `WAITING_APPROVAL` (D-C2-13).

The CLI installs no service, creates no scheduled task and opens no network port.

## Validation

CI (`.github/workflows/ci.yml`, D-R1-07 / D-C4-08) classifies each change. A documentation-only change
takes a fast, fail-closed docs path (install, build, verifier). Every other change runs the FULL proof
set on Windows AND Linux as parallel jobs (static, tests, sharded mutation checks, C1–C6 acceptances and the C5 browser smoke);
the single required status `quality-gate` passes only when every job succeeded and every recorded
mutation ran exactly once per operating system. A push to `main` whose tree is exactly the tree a green
PR run proved takes a fast integrity path; anything else runs the full set. A manual run
(`workflow_dispatch`) always runs the full set. The verifier first proves that each of its rules can fail,
then checks the repository: required files and docs, private packages, bounded Node 24 engine, npm
workspaces and lockfile, no tracked `.env` / secret / `node_modules` / SQLite / native-binary files,
no App-repository dependency, no `tar` usage, no APP-OPS implementation, no placeholder packages,
explicit `.gitattributes`, and (locally) `core.longpaths=true`. It also checks:
- the imported authority: every manifest hash, no unlisted or non-Markdown file, and the missing
  Stage 16 recorded;
- that no archives are present;
- that the baseline carries the privacy rules and no stale default-with-exception wording;
- the lifecycle state:
  - `C0` closed;
  - `C1`–`C6` not claimed closed without a closure record;
  - `C2` not started before C1 closes, `C3` not before C2 closes, `R1` / `C4` not before C3 closes,
    `C5` / `C6` / `C7` not before C4 closes, `C6` / `R2` / `C7` not before C5 closes, `R2` / `C7` not before C6 closes;
- the C1 boundaries: `node:sqlite` only in the storage adapter, no network code in runtime packages,
  no third-party runtime dependencies, released migrations pinned by SHA-256, and the C1 proof tests
  present;
- the C2 boundaries:
  - provider adapters called only by the governed Model Runtime;
  - tool drivers invoked only by the Tool Executor;
  - budget / reservation / usage writes only in the storage governance modules, behind fenced
    functions;
  - no plaintext secrets or secret-shaped columns;
  - canonical migrations 0001–0004 frozen by content;
  - no C5–C7 tables or packages (Command Center, Founder ↔ CEO conversation, dashboards, APP-OPS);
  - the test-only Founder seam unreachable from production code, no Founder-attestation
    activation, and no Founder write command on the CLI (D-C2-13);
  - the C2 proofs and the mutation check present;
- the C3 boundaries:
  - Context Assembly mandatory: only the assembler calls the storage assembly, the Model Runtime
    accepts only a context the assembler minted and binds the reservation to its manifest, and the
    model request carries no messages;
  - durable Memory / Knowledge / Skill / Academy state written only by the C3 storage modules,
    memory candidates submitted only by the runtime's memory-proposal path, and no Founder /
    evaluator act called by runtime code or the CLI;
  - skill payloads loaded only by the one pinned, eligibility-checked, hash-verified loader;
  - the `mind` kernel pure (no I/O, storage, runtime, provider or tool driver);
  - no content in C3 audit / events / logs;
  - the `employees_activation_gate` trigger present and no test-seam activation label in
    production code;
  - the C3 proofs and the mutation check present;
- the C4 boundaries:
  - organization / delegation / review state written only by the C4 storage modules, and no Founder
    organization or review act called by runtime code or the CLI;
  - no staffing evidence, handoff message, review rationale or reviewer instructions in telemetry;
  - a review never satisfies R4 (datastore CHECK) and the kernel keeps R4 Founder-only;
  - the Review Pool is not a Department; the seeded Department map is exactly the canonical five;
  - the C4 proofs and the mutation check present;
- the C6 boundaries: the C6 proofs and mutation check present; no universal score, rank or leaderboard in code
  or schema; no reflection, lesson content, Goal text or passphrase in C6 telemetry; the portable package
  authenticated-encrypted and the recovery passphrase never written or taken from a command line;
- the C7-A boundaries: no static external-outcome flag (availability is governed evidence) and every outcome
  verification runs the governed external-evidence rule backed by datastore triggers (including the registered-contract
  and late-conflict contest triggers), and the evaluator trusts only a current verification; content-free intake telemetry, no
  raw-payload / user / secret column and no pseudonym outside the kernel; external-evidence writes confined to the C7-A
  storage modules (no CLI / runtime register, bind or ingest); no parallel evaluation / learning / report store; no
  C7-C / C7-D scope; C7-A not claimed closed without its record; the C7-A proofs and mutation check present;
- the C7-B boundaries: exactly the seven families (kernel and datastore), an empty Remote Configuration register, R3,
  every control-plane datastore trigger, ISSUED as the only Company state; control-family vocabulary only in the C7-B
  modules; control-plane writes only in its store and its issuing hook only in the approval engine; no evaluation,
  spawn, dynamic import or network path and no secret / key / signature / private column in C7-B; the App Operations
  & Release Lead created as its own vacant seat (no seat edited, nobody hired, assigned or granted); refusals counted,
  not audited row by row; C7-B not claimed closed without its record; the C7-B proofs and mutation check present;
- the C7-C boundaries: C7-C only after the C7-B closure record; every Pilot datastore gate; only the Pilot identity and
  history tables (no second evaluator, ledger, review or learning store); no private-content, secret or score column;
  Pilot writes only in its store and never from runtime / CLI / surface internals; exactly the eight readiness criteria;
  autonomy read from JUDGMENT + INDEPENDENCE only; no network path, C7-D scope or App-effect claim in a C7-C module; C7-C
  not claimed closed without its record; the C7-C proofs and mutation check present;
- the L1-01 boundaries: L1 only after the C7-D closure record; L1-01 not claimed closed without its record; the L1 proofs and
  mutation check present; the Windows vault protects with DPAPI (CurrentUser) through the signed PowerShell host started by
  its absolute path with no shell and the payload on stdin, under the user's local application data, with no network path,
  and the vault command refuses a secret argument and prompts in raw mode; the DeepSeek transport talks to one fixed origin
  with no redirect and the endpoint allowlist, no other network path or host in the provider package, no provider tools or
  streaming, the bearer only in the transport, the exact E1–E4 thinking table, and no src module anywhere reads the
  provider's chain-of-thought field; settlement records the actual cache-hit / banded bill while the worst case stays flat,
  and migration 0016 carries the schedule, cached-input and identity-check gates plus the provisioning intent;
- the C7-D boundaries: C7-D only after the C7-C closure record; every workshop datastore gate; only the digital tables (no
  second review, approval, cost, schedule or Pilot store) and no content / blob / secret / score column; digital writes only
  in its store; drivers never reach the store, runtime, SQLite or filesystem, never force, and GitHub talks to one fixed host
  with least-privilege permissions and a closed endpoint allowlist; the Preview on 127.0.0.2, sandboxed, cookie-free; no
  website / hosting / CMS / analytics / social vendor named; no publication-as-success claim; C7-D not claimed closed or the
  website claimed built; the C7-D proofs and mutation check present;
- the CI contract: triggers, SHA-pinned actions, both operating systems, complete mutation shard
  partitions, the always-running quality gate, and a fail-closed change classifier.

## Windows notes (Founder host)

- **Smart App Control stays on.** It blocks unsigned native executables and DLLs, so the project
  uses only the signed Node runtime and pure-JavaScript dependencies. Do not add native addons or
  locally built executables without a Product Owner decision.
- **Git:** system Git's HTTPS is blocked on this host. Use GitHub Desktop's signed bundled Git
  (`%LOCALAPPDATA%\GitHubDesktop\app-<version>\resources\app\git\cmd\git.exe`; the version folder
  changes when Desktop updates).
- **Long paths:** every local clone needs repository-local `core.longpaths=true`.
- **URL rewrite:** the Founder's global Git config rewrites `https://github.com/allamqandeel/qandeel…`
  to SSH for the App. Clone this repository with the self-mapping that cancels it (decision
  D-C0-06):

  ```bash
  git clone -c core.longpaths=true -c core.quotepath=false -c url.https://github.com/allamqandeel/qandeel-company.insteadOf=https://github.com/allamqandeel/qandeel-company https://github.com/allamqandeel/qandeel-company.git
  ```

- **Backups:** never use Windows `tar.exe` (it crashes on Arabic file names). Use a Unicode-safe
  method.
- **Secrets (L1-01):** provider keys live only in the Windows user vault (`%LOCALAPPDATA%\QANDEEL_COMPANY\vault`,
  DPAPI CurrentUser through the signed PowerShell host). A portable backup or a workspace copy never contains them; on a
  new device or user account, store them again with `qandeel-vault set`.
- **Line endings:** text is LF everywhere (`.gitattributes`); PowerShell files, if added, are CRLF
  and UTF-8 with BOM.

## Operating the Company from Windows (OPS)

The Founder opens the Company with the **QANDEEL COMPANY** shortcut (Desktop and Start menu); no terminal, port or
workspace path is needed. The shortcut runs `qandeel-founder open`, which reuses the running Company host or starts
exactly one (the existing `serve`, detached and windowless), and opens the existing Command Center in an Edge (else
Chrome) app window. The browser hands the fresh single-use launch token over through a one-shot loopback handoff; the
token is never in the browser's command line. Closing that window does not stop the Company. The Start
menu folder **QANDEEL COMPANY** also holds **Status**, **Stop** (controlled shutdown) and **Restart**. Nothing starts at
Windows sign-in. Details: `docs/OPS_FOUNDER_DESKTOP_PACKAGING_REPORT.md`.

**QANDEEL COMPANY Desktop v1 (D1).** The Founder installs the product with `QANDEEL-COMPANY-Setup.exe`: a per-user
install into `%LOCALAPPDATA%\Programs\QANDEEL COMPANY\` with its own private Node runtime, no elevation, no terminal,
Git, npm or global Node. Setup adopts the EXISTING Company (the launcher configuration, or the Founder's choice of an
existing workspace; it never creates one), activates its bundled release through the canonical activation below, and
writes the branded Desktop and Start-menu shortcuts (no console window). A newer Setup updates through the same
activation (rolled back on failure); running the same Setup again repairs; uninstalling removes the application only —
the Company, its backups, the vault, the releases and the configuration stay. Build and proofs: `packaging/windows/README.md`.

**The shortcuts run an activated release, never this checkout (D-OPS-08).** A release is a frozen, content-addressed copy
of a build under `%LOCALAPPDATA%\QANDEEL_COMPANY\releases\`. Once a release is activated for the production workspace,
the runtime refuses any other build for it (`RUNTIME_RELEASE_REFUSED`), including this checkout's own `dist`. Branch
switches, `npm ci` and rebuilds therefore never change what the Founder starts.

To put a new build into production, the exact commit must first have one green **FULL** GitHub quality gate (D-D0-01; a
local `npm run ci` is proportional validation, not release qualification). Then run `npm ci` and `npm run build` in this
checkout, and freeze the build (this prints the release ID):

```bash
node packages/command-center/dist/src/cli.js release-stage
```

Then activate it, passing that ID as `--release`:

```bash
node packages/command-center/dist/src/cli.js release-activate --workspace "<production workspace>" --release <id> --provider deepseek
```

Activation is the one controlled path. It runs verify → dry run → controlled stop → verified backup → pin → start from
the release (schema safe-upgrade inside) → health → shortcuts. A failure rolls back to the previous release.

`install-shortcuts --workspace "<production workspace>" --provider deepseek` records the workspace (no secret) in
`%LOCALAPPDATA%\QANDEEL_COMPANY\launcher\founder-launcher.json` and rewrites the per-user shortcuts for the activated
release; no elevation. The Company host's content-free log is `<workspace>\runtime\founder-host.log`.

## License

Proprietary — all rights reserved. See `LICENSE.md`.
