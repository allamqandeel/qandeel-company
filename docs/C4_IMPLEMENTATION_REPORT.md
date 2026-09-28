# C4 — Organization + CEO + Directors + Delegation + Review Pool — Implementation Report

**Status: C4 — IMPLEMENTATION CANDIDATE / NOT CLOSED**

C4 is not closed, merged or canonical. This report is evidence for the Technical Lead's exact-head review;
it does not close C4 (no `C4_CLOSURE_RECORD` exists). C5 is not started.

<!-- Sections 1–4 were written BEFORE any C4 code (design gate); later sections record the results. -->

## 1. Start gate (re-proved from repository truth, 2026-09-28)

| Item | Evidence |
|---|---|
| Repository | `allamqandeel/qandeel-company`, root `E:\QANDEEL COMPANY\PROJECT`, origin `https://github.com/allamqandeel/qandeel-company.git` |
| Canonical base | `origin/main` = `a60cc3e8ab21a23f9206fbc272b92c95cfdf2159` after `git fetch` (signed GitHub Desktop Git, command-local self-mapping, D-C0-06) |
| R1 | PR #6 MERGED as `bd18614d1fc49d3c03ace2289e19accd67aa1838`; `docs/R1_CLOSURE_RECORD.md` present — **R1 CLOSED / MERGED / CANONICAL** |
| R1 docs-sync | PR #7 MERGED as `a60cc3e`; merge parents `bd18614` + `8843d10` |
| Validation policy (D-R1-07) | PR #7 exact-head run `36451108574` SUCCESS on Windows + Ubuntu; merge tree `d59c6c6fd6214eafd943702b4d1b9ed21f45d8fc` **byte-identical** to the green PR head tree (the redundant post-merge run `36460309937` need not complete) |
| Implementation Map | post-R1 cross-stage integration rules present; C4 `READY / Not started` |
| Decision Log | D-R1-02 (integration/validation), D-R1-03 (P-07), D-R1-04 (CEO amendment), D-R1-05 (Engineering), D-R1-06 (operational scaling), D-R1-07 (single heavy gate) present |
| R1 BLOCKER / MAJOR | none unresolved (`docs/R1_INDEPENDENT_CORE_REVIEW_REPORT.md` §12) |
| C4 started elsewhere | no `c4/*` branch locally or on origin; no open PR |
| Local state | clean tree; local `main` fast-forwarded to `a60cc3e`; branch `c4/organization-directors-delegation-review-pool` created from it |
| Toolchain | Node 24.19.0, npm 11.17.0, bundled SQLite 3.53.3 (Founder host, Windows 11, Smart App Control on) |
| Latest migration | `0006_c3_skills_academy.sql` (0001–0006 frozen) |

## 2. Legacy Organization Dependency Census and Compatibility Matrix (design gate)

The census covered every read/write of `employees.department_id / position_ref / manager_ref / role_ref`,
`run_attributions.department_id`, the budget hierarchy, reservation / usage attribution, knowledge scopes,
authority / routing reads, the test seams, fixtures, health and CLI (`grep` over `packages/**/src`,
`packages/**/test`, `scripts/`, migrations 0001–0006, and a live schema dump of a real v6 workspace).

**The structural finding.** Four released C2 tables declare `department_id NOT NULL REFERENCES
departments`: `employees`, `run_attributions`, `budget_reservations`, `usage_records`; the budget chain
check (`workItemChain`) hard-requires `RUN → WORK_ITEM → EMPLOYEE → DEPARTMENT → COMPANY`. A company-scoped
CEO therefore cannot exist, run, reserve or be charged without either a fake Department or a schema
evolution. C4 chooses the documented schema evolution (D-C4-02); it does **not** create an Executive
Department, a sentinel Department row or a Department-scope budget for the CEO.

| Legacy field / path | Current consumers | C4 canonical replacement / interpretation | Migration strategy | Historical behaviour | C5 / C6 consequence |
|---|---|---|---|---|---|
| `employees.department_id` | `createEmployee`, `reassignEmployee`, `parentBudgetFor(EMPLOYEE)`, `txBeginGovernedRun`, `knowledgeAccess`, context preamble, fixtures | Canonical truth = the active PRIMARY `position_assignments` row → `org_positions.department_id` (NULL for a COMPANY-scoped seat). The column becomes a **projection** kept by the organization module in the same transaction; new `org_scope` column; `CHECK ((org_scope='DEPARTMENT') = (department_id IS NOT NULL))` | 0007 table rebuild (nullable + `org_scope`), every row copied with `org_scope='DEPARTMENT'`, all 5 triggers and 2 indexes re-created verbatim | unchanged values | C5/C6 read organization from assignments / snapshots, never from the projection |
| `employees.position_ref` | C2 create / reassign (free text), fixtures | `position:<uuid>` projection of the active PRIMARY assignment; free-text values stay for never-assigned legacy Employees; no C4 authority or attribution decision reads it | none (column unchanged) | preserved | C6 uses `run_org_snapshots.position_id` |
| `employees.manager_ref` | reassign self-check, fixtures | projection = the reports-to **seat** (`position:<uuid>`); for the CEO seat the Founder **principal** ref (`founder:<uuid>`) — the Founder stays a principal and is never made an Employee; the effective manager person at time T is resolved from assignments | none | preserved | C5 organization view resolves people per instant |
| `role_ref` / role reassignment | `reassignEmployee` (D-C3-24, R1-11, P-01), `enforceRoleCertification`, activation gate, knowledge ROLE scope | unchanged Employee attribute; a C4 assignment to a Position whose role differs applies **the same** certification gate atomically (one shared helper, not a second rule) | none | unchanged | P-01 fail-closed behaviour preserved |
| `run_attributions.department_id` | `txBeginGovernedRun`, `attributed()`, `workItemChain`, `accountingInvariants`, `run.attributed` event | nullable for company-scoped runs + `org_scope`; plus a new immutable `run_org_snapshots` row (position, assignment kind, manager seat / person, Director, CEO) written in the same transaction | 0007 rebuild (WITHOUT ROWID kept, triggers re-created) | existing rows unchanged | time-correct attribution for C6 |
| Budget hierarchy `COMPANY → DEPARTMENT → EMPLOYEE → WORK_ITEM → RUN` | `parentBudgetFor`, `workItemChain`, `PARENT_SCOPE`, `accountingInvariants` | EMPLOYEE parent = the Department budget for Department-scoped Employees and the **Company** budget for company-scoped Employees; the chain check accepts `RUN → WORK_ITEM → EMPLOYEE → COMPANY` only for a company-scoped run; every Company cap still applies | none (`budgets.parent_id` is already structural) | unchanged | CEO spend is Company-level, never hidden in a Department |
| `budget_reservations.department_id`, `usage_records.department_id` | `txReserve`, `settleReservationTx`, `accountingInvariants` | nullable; invariant "equals the run attribution" now compared with `IS NOT` (NULL-safe) | 0007 rebuild (0005's `context_manifest_id` column and both manifest triggers re-created) | unchanged | C6 Department cost excludes Company-level cost explicitly |
| Knowledge DEPARTMENT scope | `knowledgeAccess`, cross-department grant attribution | a company-scoped Employee reads Company scope + explicit grants only (no implicit Department scope) | none | unchanged | — |
| Authority / routing reads | `decideEmployeeAction` (grants only), chain check | title / Department / Position never grant; C4 organization acts need an explicit grant **and** read Position eligibility from assignments | none | unchanged | C5 delegation controls = grants + delegation records |
| Test-only Founder / activation seams | `founder-seam.ts` | unchanged; every C4 Founder act uses the same `founderAdminWrite` (fail closed in production until C5) | none | unchanged | C5 replaces the seam with the authenticated surface |
| Acceptance fixtures | c2/c3 acceptance, `c2-seed`, `c2-helpers`, `c3-helpers` create `growth` / `product` | these codes are now canonical seeded Departments: fixtures look the Department up by code | fixture adaptation only | C1/C2/C3 proofs keep their meaning | — |
| Health / CLI | governance, mind health; read-only CLI | unchanged; new content-free C4 organization / review health and read-only CLI | none | unchanged | C5 visibility builds on them |
| Context preamble | `mind-writes` "department <id>" | prints "company-level (no Department)" for a company-scoped Employee | none | unchanged | — |
| `createDepartment` (C2) | Founder authority | kept for future Departments (Stage 10 Department Creation Rule); the five canonical Departments are release-seeded by 0007, adopting an existing row with the same code | seed | — | — |

## 3. Architecture decisions taken before coding

Recorded in full as D-C4-01 … in `docs/architecture/DECISION_LOG.md`. Summary:

1. **No new package, no second engine (D-C4-01).** Pure rules in `governance` (`organization.ts`,
   `review.ts`), durable state in `storage`, orchestration in `runtime`. OpenFGA / Casbin / a policy server
   are not needed: the existing default-deny grant model expresses every C4 authority, including Founder →
   CEO staffing delegation (a scoped, capped, expiring, revocable grant plus a delegation record).
2. **C2 schema evolution for company-scoped executives (D-C4-02)** — the four-table rebuild above, proven
   on real v6 workspaces before it was written (rows, foreign keys and `integrity_check` identical; a
   deliberately dangling parent makes the migration's COMMIT fail).
3. **Positions and effective-dated assignments are canonical organization truth (D-C4-03).** One rule for
   "who holds a seat at T": a valid ACTING assignment at T, else the PRIMARY assignment at T, else vacant.
   Partial unique indexes enforce one CEO seat, one Director seat per Department, one active PRIMARY per
   seat, one active ACTING per seat and one PRIMARY seat per Employee.
4. **Employees act only through governed runs (D-C4-04).** An organizational act (staffing request,
   CEO synthesis, delegated staffing decision, work delegation, support request, handoff response,
   reprioritization, review-plan declaration) is a typed model proposal (`ORG_ACTION`) the runtime executes
   through a fenced storage write; the actor is the run's attributed Employee, never a presented reference.
   Review decisions are `REVIEW_DECISION` proposals from the reviewer's own review Work Item.
5. **Review is designed before execution and bound to a versioned subject fingerprint (D-C4-05).** R2 and
   R3 actions and review-required Work Items need a satisfied Review Request under the Work Item's active
   Review Plan; R3 additionally needs the Founder approval; R4 stays Founder-only. Reviewer eligibility is
   decided in SQL **before** the LIMIT (R1-12 family).
6. **Reviewer qualification reuses C3 certification (D-C4-06)** — a VALID certification for a reviewer
   role (Academy, holdouts = Gold Cases) + calibration evidence + Founder admission; no second
   certification or Skill-status system; a held / retired pinned Skill makes the reviewer ineligible (P-03).
7. **P-07 is implemented in C4 (D-C4-07)** at the durable reservation boundary and in routing.
8. **CI (D-C4-08)** — classifier + stable `quality-gate`; docs-only fast path; sharded Windows + Ubuntu
   proof families with machine-checked proof parity; post-merge tree-identity integrity with fail-closed
   fallback to the full matrix; manual full run.

## 4. What C4 builds

| Area | Where | What |
|---|---|---|
| Organization kernel | `packages/governance/src/organization.ts` | seat kinds / scopes / lifecycle, the one seat-holder-at-T rule, bounded acting windows, Staffing Request parsing (Stage 10 evidence and all four alternatives), CEO synthesis transitions, the 12 organizational acts and their capabilities, delegation bounds / cycle rule, delegation limits |
| Review kernel | `packages/governance/src/review.ts` | Review Plan parsing (≥ 1 SPECIALIST key), the one deterministic request evaluation, independence rule, calibration signal, promotion gaps, output subject fingerprint |
| Authority | `packages/governance/src/authority.ts`, `proposals.ts` | R2 → ALLOW + independent review; R3 → review AND Founder approval; R4 Founder-only; `decideOrgAct`; `ORG_ACTION` / `REVIEW_DECISION` proposals (own keys only) |
| Schema | migrations `0007_c4_organization.sql`, `0008_c4_review_quality.sql` | §5 |
| Organization store | `storage/src/organization.ts`, `org-core.ts`, `org-records.ts` | Founder acts (seats, placement / transfer, acting, hire, staffing decision, authority delegation, charters, escalation resume) and content-free reads (seat holder at T, Employee organization at T, run snapshot, executive queues, calendar projection, health) |
| Fenced acts | `storage/src/org-writes.ts` (via `runtime-authority`) | `recordOrgAct` (grant + seat + limits, idempotent per step, savepoint-rolled-back refusals) and `recordReviewDecision` |
| Review engine | `storage/src/review-core.ts`, `review.ts` | plans, requests, eligibility-before-LIMIT selection, review Work Items, decisions re-checked at the boundary, evaluation, conflicts, escalations, calibration, oversight, holds, action-review gate, lost-wake re-checks, bounded recovery sweep |
| Governed writes | `storage/src/governed-writes.ts`, `queue.ts`, `work-core.ts`, `mind-writes.ts` | company-scoped chain, run organization snapshot / acting expiry / delegation acceptance at run start, P-07 at the reservation, the review gate in the tool intent, C4 wait re-checks, output review at completion, abandoned review keys released at any terminal transition, handoff messages / reviewer rationale in the governed context (L6) |
| Runtime | `runtime/src/c2/employee-task.ts`, `runtime.ts`, `c2/model-runtime.ts`, `c4/health.ts`, `cli.ts`, `recovery.ts` | `ORG_ACTION` / `REVIEW_DECISION` checkpointed like tools; FINAL waits while a handoff is open; P-07 routing filter; `rt.org` capability object; C4 health; `organization` / `reviews` CLI; recovery reconciliation |

## 5. Migrations

| Migration | Content | Pin (LF-normalized SHA-256) |
|---|---|---|
| `0007_c4_organization.sql` | rebuild of `employees`, `run_attributions`, `budget_reservations`, `usage_records`, `budgets` (company scope; per-placement envelopes); `org_positions` (+history), `department_charters`, `position_assignments` (+history), `staffing_requests` (+history), `authority_delegations`, `work_delegations` (+history, follow-child trigger with targeted wake), `handoff_messages`, `org_act_records`, `run_org_snapshots`, `charged_exclusion_releases`; seed: five canonical Departments (adopted by code), CEO seat, five Director seats, the Product release-reputation lead seat, five baseline charters | `9c46b838c21caf7b38d5db1244fc6fdd83c5e47f1a24fe2f973a9828f417fc3b` |
| `0008_c4_review_quality.sql` | `review_plans` (before-execution trigger), `reviewer_qualifications` (+history), `review_requests` (+history; R4 CHECK), `review_assignments` (distinct-keys index), `review_decisions`, `review_calibrations`, `review_conflicts`, `quality_holds`, `oversight_findings` | `d937856f2a730ff33d3fb83f61c8e6b3ce0c932c4189492d6c50e8eeafb899f5` |

0001–0006 are unchanged (verifier `released-migrations-frozen`). Both new migrations were applied to real
v6 workspaces (C2- and C3-era) with `integrity_check` ok and zero foreign-key violations, and a v6 → v8
upgrade proof keeps every organization / money row and adopts an existing `growth` Department by code.

## 6. Backward Integration Gate (C1 + C2 + C3 + R1)

| Invariant | How C4 preserves it | Evidence |
|---|---|---|
| `node:sqlite` only in the adapter; one short synchronous `BEGIN IMMEDIATE` per mutation | all C4 writes run inside the caller's transaction; a refused org act rolls back only its own writes (SAVEPOINT inside the same transaction) | verifier `sqlite-confined-to-storage`; tests |
| Released migrations immutable | new 0007 / 0008 only; the destructive-statement guard admits only the exact row-preserving rebuild | `migrations.test.ts` (guard + v6 → v8) |
| Fenced worker writes; only the Supervisor claims | org acts and review decisions take the job fence; `reconcileOrganization` takes the supervisor fence | `supervisor-authority.test.ts` (C4 case); C1 mutation now removes 9 checks |
| Wake generation advances with actionable work | review / handoff wakes go through `queue_jobs` updates (trigger-maintained generation), including the follow-child trigger | lost-wake proofs (`c4-review`, `c4-organization`) |
| No hard deletes; history append-only | every C4 table has no-delete / append-only / forward-only triggers | migrations |
| C2 authority: default deny, R3 Founder approval, R4 Founder-only, self-escalation refused | unchanged kernel paths; R2 / R3 gain an independent review; org acts need grants; only the Founder delegates authority | `c4-kernel`, `c2-governance` (R3 = review then approval), C2 mutations |
| C2 budgets / accounting | company-scoped chain; per-placement envelopes; `accountingInvariants` NULL-safe | `c4-organization` (CEO, transfer), accounting invariants in tests / acceptance |
| C3 role-change certification rule (D-C3-24 / P-01) | C4 placement uses the one reassignment path | transfer test (stays ACTIVE with same role) |
| C3 context assembly mandatory; L6 only from governed services | handoff messages / review rationale enter as governed RECENT candidates, integrity-verified | `c4-runtime` (rationale in the rework manifest) |
| C3 Founder surface fails closed | every C4 Founder act uses `founderAdminWrite` | `c4-organization` production posture; C4 acceptance step 1 |
| Rule A | C4 audit / events carry IDs, codes, states only | verifier `c4-telemetry-content-free`; Rule A assertions in tests and acceptance |

Adaptations of existing proofs (strengthening only): fixtures adopt the release-seeded `growth` / `product`
Departments by code; R3 proofs pass an independent review before the approval they test; the R2 runtime
proof grants the action before the review gate (R2 is default-deny like everything).

## 7. Forward Integration Gate (C5 / C6 / C7 seams — nothing of them implemented)

- **C5** (Founder Command Center, Founder ↔ CEO conversation, delegation controls, Company Calendar):
  `OrganizationStore.executiveQueues()` (CEO synthesis queue, Founder decision queue, escalated handoffs),
  `calendar(from, to)` (acting ends, handoff dues, staffing decision dues), `delegateAuthority` /
  `revokeDelegation` with limits, `authorityDelegations()`, the Founder acts behind `founderAdminWrite`
  that C5's authenticated surface will arm. No conversation, UI or approval inbox was built.
- **C6** (performance, learning, reporting): immutable `run_org_snapshots` (who the Employee was, at which
  seat, under which Director / CEO, when the run began), effective-dated assignment history, staffing and
  delegation histories, review decisions with plan / rubric / qualification versions, calibration evidence,
  oversight findings. No analytics or dashboards were built.
- **C7** (APP-OPS, Pilots): nothing; the verifier still refuses APP-OPS tables / packages.

## 8. R1 defect-family non-regression

| R1 family | C4 application |
|---|---|
| R1-06 lost wakes at WAIT settle | `AWAITING_INDEPENDENT_REVIEW`, `AWAITING_DELEGATION`, `AWAITING_CLARIFICATION`, `AWAITING_ESCALATION` re-checked at the settle; the delegation re-check never wakes on its own offer (no model loop) — mutations `c4-review-wait-not-rechecked`, `c4-delegation-wait-free-wake` |
| R1-12 eligibility after LIMIT | reviewer eligibility decided in SQL before the LIMIT — `c4-quality-hold-ignored-in-selection` |
| R1-03 per-Work-Item steps | org acts are idempotent per Work-Item-global step and replay on resume |
| R1-09 accounting truth | P-07 is computed from the durable money records; no second accounting state. The full local run found that the new P-07 reservation refusal **masked** the R1 mutation `r1-09-charged-attempt-retried` (a same-deployment paid retry was refused by P-07, so the R1 proof still passed). The R1 proof now also asserts that no reservation was refused (the runtime never attempts the retry; P-07 is only the backstop), so each gate is again individually load-bearing — the mutation is caught |
| R1-01 / R1-02 secrets and own-key parsing | handoff / staffing / rationale text refused when it carries secret material; every C4 input parsed by own keys only |
| R1-11 role reassignment | C4 placement reuses the one reassignment path |
| R1-15 pinned mutation checks | 25 C4 mutations pinned in the verifier; scripts only grow |

## 9. Closure Integration Matrix

| Requirement | Implementation | Proof |
|---|---|---|
| CEO company-scoped, never a fake Department | 0007 rebuild, `org_scope`, company chain | `c4-organization` CEO test; mutation `c4-ceo-needs-department`; acceptance |
| Legacy dependencies solved | §2 matrix | v6 → v8 test; fixture adaptation |
| Founder stays Founder | CEO seat reports to the Founder principal | CEO test (`managerRef` = Founder ref) |
| Engineering the permanent fifth Department | seed + verifier `review-pool-not-department` (exact five) | skeleton test; acceptance |
| Headcount is data | seat lifecycle, staffing, hire | headcount test; acceptance |
| Time-correct assignments / attribution | assignments + run snapshots | transfer test |
| Acting coverage | bounded, expires by time, delegated authority revoked | acting test; mutations `c4-acting-*` |
| Title ≠ Authority | grant + seat for every act | staffing test; mutations `c4-org-act-grant-bypassed`, `c4-org-seat-eligibility-removed` |
| Work ≠ authority delegation | delegation grants nothing; reporting line; aggregate parent cap | delegation test; mutation `c4-delegation-outside-reporting-line` |
| Execute ≠ Review ≠ Approve; R4 | review gate before approval; R4 CHECK | R2 / R3 / R4 tests; mutations `c4-action-review-*` |
| Review Pool dynamic, not a Department | qualification registry; eligibility before LIMIT | review tests; verifier rule |
| Independent Oversight | separate request kind; findings; conflicts | oversight test |
| P-07 | reservation + router + count-based release | storage + runtime tests; 3 mutations |
| Privacy Rules A / B / C | content-free telemetry; content only in local governed context | verifier rules; Rule A assertions |
| CI (D-R1-07) | §12 | verifier `ci-contract`, `ci-classifier-fails-closed`; the PR gate |

## 10. P-07 status

**IMPLEMENTED in C4 (D-C4-07).** Router filter (`model-runtime.ts`) and reservation refusal
(`governed-writes.ts`), both from `chargedExclusions` (FAILED_CHARGED or possibly-billed holds per Work Item
and deployment, across every run and job); Founder release by count coverage. Proofs: `c4-review.test.ts`
(storage, cross-run, per-Work-Item, release, re-exclusion after a later hold), `c4-runtime.test.ts`
(runtime, a new run never calls the charged deployment and never even proposes it), C4 acceptance step
`p07-charged-failure-excluded-across-runs`. Mutations: `c4-p07-reservation-unchecked`,
`c4-p07-router-unfiltered`, `c4-p07-release-covers-future` — all caught. Not deferred.

## 11. Validation results

Local Founder-class host (Windows 11, Node 24.19.0), final tree, `npm ci` then `npm run ci` — **exit 0 in
32.3 minutes** (build → typecheck → lint → test → C1 / C2 / C3 / R1 / C4 mutations → verify):

| Check | Result |
|---|---|
| Tests | bootstrap-contract 5, domain 22, governance 53, mind 53, **storage 276**, **runtime 93** — **502 / 502 passed** |
| Mutations | C1 6/6, C2 19/19, C3 40/40, **R1 45/45**, **C4 25/25** — every one caught (135) |
| Verifier | self-test ok (57 rules each proved able to fail); **58 / 58 rules passed**, 248 files |
| Acceptances | C1 PASS (6 steps), C2 PASS (8), C3 PASS (9), **C4 PASS (13)** |

Two backward-integration findings of the full local run, both fixed before the PR gate:

1. **R1 mutation masked by P-07** (§8): `r1-09-charged-attempt-retried` was not caught once the P-07 reservation
   refusal also blocked the retry; the R1 proof now asserts no reservation refusal (the retry is never even
   attempted), and the mutation is caught.
2. **C2 acceptance R3 step** expected an approval right away; under C4, R3 = independent review AND Founder
   approval (D-C4-05), so the C2 world (no certified reviewer) now proves R3 fails closed as
   `AWAITING_INDEPENDENT_REVIEW` with no approval requested and nothing executed; the review → approval →
   execute-exactly-once path is proven by the C4 acceptance and `governed-runtime.test.ts`.

## 12. CI architecture before / after (D-R1-07 / D-C4-08)

**Before** (last green `main` runs `36432971600`, `36451108574`): one job per OS running `npm run ci`
sequentially plus the acceptances — **Windows ≈ 66.8 / 67.7 min, Ubuntu ≈ 26.5 / 24.0 min** per run, for
every PR AND again for every push to `main`. Windows mutations alone: C1 0.8, C2 4.9, C3 14.4, R1 40.4
minutes. Adding C4's 25 mutations sequentially would have pushed the Windows job past its 75-minute
timeout.

**After:** `classify` → (docs-only) `docs-fast` | (post-merge, proven tree) `integrity` × 2 OS | (full)
`static` × 2, `tests` × 2, `mutation` × 14 shards (Windows 9, Ubuntu 5), `acceptance` × 2 → `quality-gate`.
Every job fits the Free plan's 20 concurrent jobs.

__CI_TIMING__

**Proof parity.** Nothing was deleted: each OS still runs every test, every verifier rule, the C1–C4
acceptances and every recorded mutation (C1 6, C2 19, C3 40, R1 45, C4 25 = 135). The shard specs are a
verifier-checked exact partition per OS and script, and the gate proves from the shards' reports that each
recorded mutation ran exactly once per OS.

**Branch protection / rulesets reality.** Not changed by C4 (no admin settings touched). The protection
API returns 403 for this private repository on the Free plan, so required checks cannot be enforced there.
Recommendation for the Product Owner / Technical Lead (when available): require the single status
`quality-gate`, require a pull request, require branches to be up to date.

## 13. G1 — Skills

| Skill | Inspected | Used | Effect / why not |
|---|---|---|---|
| `code-review` | yes | **yes** (high effort, 8 angles, over the whole C4 diff) | 9 findings; fixed: two data-class leaks into review (the subject's effective class now governs), failed review Work Items no longer strand a key (released at any terminal transition), aggregate delegation budget bounded by the parent cap, acting scope honoured in delegation, acting-expiry index; 2 recorded as residuals; 1 intended |
| `security-review` | yes | attempted, **not executed** | the skill's embedded `git status` shell step fails in this environment (the Bash tool is unavailable; PowerShell works); its angles (authority bypass, data-class leakage, Rule A, SQL / CI injection) were covered by the code review |
| `github-actions` | yes | **yes** | its artifact upload / `gh run download` retrieval pattern matches the post-merge detector; its `@v4` pins are older than the primary-source `v7.0.1` / `v8.0.1` SHAs used; the accompanying workflow review found and fixed two defects (PowerShell default shell on Windows would not fail a multi-line step; a duplicate `mode=` output on push) |
| `simplify` | yes | no | overlaps with the code review's cleanup angles, which ran |
| `workflow-authoring`, `run`, `init`, `loop`, `schedule`, `claude-api`, `update-config`, `fewer-permission-prompts`, `keybindings-help` | yes | no | not relevant to C4 (no multi-agent workflow requested, no scheduling, no Claude API code) |
| design / artifact skills (`frontend-design`, `dataviz`, `artifact-*`, `ui-ux-pro-max`, `impeccable`, `emil-design-eng`) | yes | no | C4 has no UI (C5) |
| React Native / Expo / animation / TypeGPU / media skills | yes | no | unrelated to this repository |
| `anthropic-skills:*` document skills | yes | no | no document formats were required |

## 14. Founder / Product Owner questions

D-C4-12: (1) multi-role reviewers; (2) bootstrap calibration subjects that wait for a second reviewer;
(3) policy values for acting / delegation bounds; (4) completing the baseline charters.

## 15. Residuals (MINOR — recorded, not blocking)

1. A REWORK resolution of an **oversight** conflict cannot reopen REVIEWED work (C1 state machine); it is
   audited (`oversight.rework_required`) and the finding stays open; the remedy is a Founder supersession.
2. A crash-interrupted R2 / R3 intent re-presented under the same key needs a fresh review (the first was
   consumed) — fail-closed, costs one extra reviewer run.
3. Bootstrap calibration subjects of the first reviewer of a domain keep waiting for a second reviewer
   (visible as `REVIEWER_UNAVAILABLE`) — see D-C4-12 (2).
4. `security-review` skill could not execute in this environment (see §13).
5. Branch protection cannot be set on the current plan (§12).

## 16. Not in C4

No C5 (Founder Command Center, Founder ↔ CEO conversation UI), no C6 dashboards / analytics, no C7 APP-OPS;
no CEO identity or headcount invented; no real provider or credential; the QANDEEL App repository untouched.
**C5 NOT STARTED.**
