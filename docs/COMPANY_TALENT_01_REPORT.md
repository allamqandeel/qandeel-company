# COMPANY-TALENT-01 — Universal Staffing, Identity, Skills & Academy Studio

**Status:** implementation candidate on branch `talent/company-talent-01`, from `main` @ `2979201`. It is not merged and
not installed. LIVE is unchanged and Majed El Kedwany is not created. Decision records: D-TALENT-01 … D-TALENT-11 in
`docs/architecture/DECISION_LOG.md`. Research: `E:\QANDEEL_D2\evidence\company-talent-01-wp0\WP0.md` (Founder-approved
with changes on 2026-10-16).

**Goal (Founder).** This is the last time QANDEEL COMPANY's code changes just to create a new AI Employee, set up its
Skills or train it. A new role is now data, drafted in the Company's own surface and approved by the Founder:
- an identity profile;
- an Academy program with Skills, scenarios, competencies and Tool needs;
- a seat;
- a Department budget.

Every decision runs through the existing governed confirmation.

## 1. What was reused, and what is new

**Reused unchanged:**
- The Founder preview → fingerprint → confirm path.
- The organization: seats, assignments and staffing requests.
- `permission_grants` and the authority decision.
- The budget engine.
- BQM-2 qualification, static security review and Skill reuse.
- The Academy engines: enrollment, attempts, the deterministic rubric, remediation, shadow work, probation,
  certification, Founder Calibration and the activation gate.
- Context Assembly.
- The fixed-host GitHub documentation reader.
- The org-act path and its idempotency.

**New, as Company data:**

| Area | Mechanism | Decision |
|---|---|---|
| Talent Catalog | `talent_definitions`: identity profiles and Academy programs, DRAFT → SUBMITTED → APPROVED → SUPERSEDED, digest-frozen by triggers; release and catalog packages resolve through one list | D-TALENT-02 |
| Identity without code | Stage 4 §7 completeness gate; deterministic kernel; `employee_identity_bindings` (INITIAL / MINOR / MATERIAL); live organization in context; no hire without an identity | D-TALENT-03 |
| Manager-led staffing | `headcount` 1..10 (D7); N seats on approval, no Employee; the Founder decides when no ACTIVE CEO exists; conversation → request without re-entry | D-TALENT-04 |
| Department budgets | `DEPARTMENT_BUDGET`; Department Employees need their Department budget | D-TALENT-05 |
| Leadership access policies | Four templates; one individual grant per eligible PRIMARY CEO / Director holder; reconciled in the transaction; Ahmed's existing grant adopted | D-TALENT-06 |
| D5 manager evaluation | `academy_manager_evaluations`; qualified direct manager; independent review for assessments; never self-evaluation; leaders by the Founder only | D-TALENT-07 (controlled amendment of D-C3-10 / D-C3-22 7.1) |
| Specialized competence and Tools | Program competencies (critical → FAIL, targeted retraining); Tool scenarios; honest readiness; certification Tool scopes | D-TALENT-08 |
| Developing ACTIVE Employees | `EMPLOYEE_RETRAIN`; new program versions; passports not redone | D-TALENT-09 |
| Unified Founder UI | The Staff & Training hall (five tabs) and a generalized seat case | D-TALENT-10 |
| Migration | `0024_talent_studio.sql`, additive; v23 → v24 preservation proved | D-TALENT-11 |

**What is unchanged:**
- The CEO packages v1–v7 and their pinned digests.
- The CEO identity profile and the first CEO's context (proved identical across the upgrade).
- Product Knowledge.
- Every closed system.

**Not built (out of scope by the Founder):**
- social-platform or video-editing adapters;
- paid tests;
- any LIVE change.

## 2. Acceptance criteria → evidence

Test files:
- S = `packages/storage/test/talent-studio.test.ts`
- M = `packages/storage/test/talent-migration.test.ts`
- R = `packages/runtime/test/talent/company-talent.test.ts` (the real runtime, the real DeepSeek adapter behind a fake
  transport, an in-memory vault; no network, no paid call)
- U = `packages/command-center/test/talent-studio-surface.test.ts` (the Founder surface over loopback HTTP)
- K = `packages/mind/test/talent.test.ts` and `packages/governance/test/talent.test.ts` (pure contracts)
- V = the real-UI proof in headless Edge: `E:\QANDEEL_D2\evidence\company-talent-01\proof\01..11 *.png` with
  `manifest.json`, all 11 steps PASS (isolated data directory, no provider call)

### 1. Majed: approved identity and a specialized Academy program through the general UI

**Status: proved with a placeholder text.** The Founder-approved `MAJED_EL_KEDWANY_APPROVED_SPEC.md` has not been
provided yet. `docs/talent/README.md` holds his entry as pending.

**Evidence:**
- **R test 1.** The Strategic Market Intelligence Director goes from the catalog to ACTIVE:
  identity drafted and approved → hired as CANDIDATE (policy grants issued) → Department budget → model access → the
  catalog program qualified under BQM-2 and installed → a critical competency fails an assessment (no certification) →
  targeted retraining → retest → holdout → shadow → probation → VALID certification → Founder Calibration (required for a
  leader, enforced) → ACTIVE. Every attempt context carries the approved kernel and "you report to <CEO>".
- **V steps 03–05 and 08–10.** The same path in the real UI: the Identity studio, the governed approval preview, the
  hire naming the identity, the program from the template (BQM-2 pins, Calibration), the policy preview, and People &
  progress.

**When the specification arrives:**
1. Copy it verbatim to `docs/talent/`.
2. Derive the fixture profile from it.
3. Re-run R test 1 and V.

No code changes.

### 2. A Reddit employee with Skills, without code

**Evidence:**
- **R test 2.** A Reddit Growth Specialist seat sits under the Growth Director seat (D1). It uses a catalog identity and a
  catalog program with the platform-growth competency preset (research, source verification, opportunity discovery,
  metrics, hypotheses, experiments, update discipline). The run includes a failed critical competency, retraining,
  certification and ACTIVE. No Founder Calibration (specialist) and no leadership grant.
- **S-A.** Catalog Reddit program validation and resolution.
- **S-C.** Two Reddit seats with two identities.
- **S-F.** A Reddit specialist evaluated by its manager.

### 3. A Video Editor showing tool-integration status honestly

**Evidence:**
- **R test 4/5.**
  - The `video-editor` Tool is NOT_REGISTERED.
  - The Tool scenario is refused, so it is never assessed.
  - The certification records `video-editor: NOT_ASSESSED / NOT_REGISTERED`.
  - The Employee is still certified on its text Skills and activated by the Founder.
- **S-G.** Readiness is NOT_REGISTERED, then NOT_INTEGRATED for a registered Tool without a driver; the scope is
  NOT_ASSESSED.
- **K.** A Tool scenario is never practice and never replaces the text assessment.

### 4. Repeatable hiring and training for different roles

**Evidence:**
- **R tests 1, 2, 4/5.** Three different specialties in three Departments (Strategic Market Intelligence, Growth, Brand
  & Creative) from one build, through the same intents. There is no role-specific code, package or identity file.
- **S-C.** N identical seats, each with its own identity and record.
- **S-B.** Identity revision: MINOR versus MATERIAL (REVIEW_DUE).
- **D-TALENT-09.** Retraining an ACTIVE Employee without re-creating it.

### 5. A manager can propose hiring and evaluation within its rights

**Evidence:**
- **S-C.** A Director with the standing proposal right files a request for 2 seats; the CEO recommends; the Founder
  approves 2 seats and creates no Employee.
- **S-C2.** A need agreed in a Founder conversation is filed from the same reply run, with no re-entry.
- **S-F.** A qualified direct manager evaluates practice (applied at once) and an assessment (applied only after an
  independent review). The trainee (`SELF_EVALUATION`), a manager who is not the direct one (`NOT_THE_DIRECT_MANAGER`) and an unqualified reviewer (`NOT_THE_EVALUATORS_MANAGER`) are refused.
- **K.** The new capabilities still need an explicit grant (Title ≠ Authority).

### 6. Conditional grants work and lapse

**Evidence:**
- **S-E.** One individual grant per PRIMARY CEO / Director holder, issued from the hire (CANDIDATE). It is revoked on
  SUSPENDED, RETIRED or leaving the seat. A specialist receives nothing.
- **S-E (Ahmed).** An existing grant is adopted: never revoked and re-issued, and kept when the policy is revoked.
- **R test 1.** The grants appear at the hire.
- **K.** Eligibility matrix; every policy grant is R0 / R1 and never hire, decide or app-control.

### 7. No hire, spend, activation or self-evaluation outside governance

**Evidence:**
- **S-A.** An incomplete identity cannot be approved.
- **S-B.** A hire without an approved identity is refused (`IDENTITY_REQUIRED`, `IDENTITY_ROLE_MISMATCH`); one identity is one person.
- **S-C.** Approval creates no Employee; a rejected or consolidated request creates nothing.
- **S-D.** No envelope without a Department budget, and none above it.
- **S-F.** Datastore triggers refuse self-evaluation and an unapplied MANAGER row.
- **R test 1.** Activation of a leader is refused before Calibration.
- **U.** No free-text path; CSRF is enforced; an approval preview moves nothing.
- **K.** No free-text command (English or Arabic) reaches a talent intent.

### 8. LIVE data and Ahmed's identity, permissions, certifications, budgets and history preserved

**Evidence:**
- **M.** A LIVE-shaped v23 Company with an ACTIVE CEO upgrades to v24:
  - every row, grant, budget, certification and history entry is unchanged;
  - the CEO context is byte-identical;
  - every new table is empty and nothing is created.
- **K.** The released CEO package keeps its digest.
- **S-E (Ahmed).** His grant is adopted.
- **LIVE.** It was not touched: no install, no data change.

## 3. Review gates and what remains

- **Gate 1 — PR review.**
- **Gate 2 — FULL GitHub gate.** The change has a migration, so it is a FULL-boundary change, run once on the exact final
  head.
- **Gate 3 — Founder's own install (separate approval).** On install, the upgrade creates no policy, grant or Employee.
  The Founder then approves the policies, budgets and identities in the Staff & Training hall.
- **Pending from the Founder:** `MAJED_EL_KEDWANY_APPROVED_SPEC.md` (criterion 1, as a data step).

## 4. Test results

Local, on Windows (Node 24), on commit `d04a343` (the code is unchanged since; this report was edited afterwards):

- `npm ci`: pass.
- `npm run ci` (proportional runner, mode **FULL**, 63 changed files): **15 / 15 steps passed**.
  - build, typecheck, lint and verify;
  - the impact-map, classify, gate and post-merge self-tests.

| Workspace | Files | Tests | Result |
|---|---|---|---|
| command-center | 18 | 84 | 84 passed |
| command-center-ui | 9 | 58 | 58 passed |
| governance | 13 | 138 | 138 passed |
| mind | 9 | 168 | 168 passed |
| runtime | 27 | 245 | 245 passed |
| storage | 47 | 626 | 626 passed |
| tool-drivers | 3 | 32 | 32 passed |

The domain, model-providers, secret-vault and bootstrap-contract suites also passed in a separate full run.

**Still required on GitHub.** The FULL continuity proof runs there: Windows + Ubuntu, every workspace test, every recorded
mutation family sharded with parity, acceptance and the verifier. It must be green on the exact final head before any
merge.
