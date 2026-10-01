# C7-A Implementation Report — Operational Data + External Outcome Core

**Status:** IMPLEMENTATION CANDIDATE — NOT CLOSED. Ready for Technical Lead exact-head review; no closure record is
written before that review and the merge. C7-B, C7-C and C7-D are not started.
**Branch:** `c7a/operational-data-external-outcome-core` from `main` @ `2eafbedac0d7c8e60e72d2a2ca48fcc6ff967bc5`.
**Decisions:** D-C7A-01 (Product, recorded) and D-C7A-02 … D-C7A-09 (engineering) in `docs/architecture/DECISION_LOG.md`.

## 1. Start gate (repository truth)

| Check | Result |
|---|---|
| Repository | `allamqandeel/qandeel-company` (`origin` https remote) |
| `origin/main` | `2eafbedac0d7c8e60e72d2a2ca48fcc6ff967bc5` = the expected baseline (fetched with GitHub Desktop's signed Git; `gh api` agrees) |
| PR #12 | MERGED 2026-09-30T21:56:23Z from head `ba6f4b7a…`; merge commit `2eafbed`; PR tree = merged tree `1053d74a…` |
| CI | exact-head run #88 full Windows + Ubuntu SUCCESS; post-merge run #89 fast-integrity SUCCESS |
| Migrations | 0001–0011 released and pinned in `RELEASED_MIGRATIONS`; checksums unchanged (proof 33) |
| Working tree | clean; task branch created from exact `origin/main` |
| Lifecycle sync | `docs/R2_CLOSURE_RECORD.md` (new); implementation map (R2 closed; C7 split; C7-A active; B/C/D not started); lifecycle note appended to the R2 report (narrative unchanged); APP-OPS-01 "candidate" wording corrected in `COMPANY_CANONICAL_BASELINE.md` §6 and `BOUNDARIES.md`; D-C7A-01 records the C7 split and the future C7-D Marketing / Founder-publish-gate decisions; README lifecycle rows |

No material drift from the expected baseline; no `AUTHORITY CONFLICT` was found.

## 2. Authority read

`CLAUDE.md` order: README; baseline (Rules A / B / C); the authority index; Stage 17 (closure, decision register,
handoff — reporting, causal attribution, Completed ≠ Reviewed ≠ Outcome Verified, provider-independent evaluation);
`IMPLEMENTATION_AUTHORITY_RULES.md`; implementation map (D-R1-02 integration gates); `BOUNDARIES.md`; the brief. The
imported Stage set holds no APP-OPS contract (App authority stays in the App repository); its only telemetry text is
Stage 12's, consistent with Rule A. The frozen APP-OPS-01 domains and the C7 split come from the brief's Product
decisions (§1), recorded as D-C7A-01. Stage 16 remains missing and was not reconstructed.

## 3. Skills used

| Skill | Concrete effect |
|---|---|
| `code-review` (high, on `main...HEAD` before the final gate) | 7 findings, all fixed and re-proven: `bindings()` filtered after its LIMIT (now SQL-filtered); privacy-screen refusals were not counted per source (now attributed to the registered key's source id — an identifier, never content); the `EVIDENCE_BIND` preview could offer a binding the confirmation refuses (shared `txAssertBindable`); a contract registration silenced an integrity-conflict attention item (now judged against the last activation); report evidence was silently capped (cut now disclosed by `EXTERNAL_OUTCOME_EVIDENCE_TRUNCATED`); the contract catalog was only shallowly frozen (deep-frozen); `health()` ran N+1 / unindexed per-source scans (grouped queries) |

The other available skills (React Native, animation, UI design, document / slide formats) do not apply to a
backend storage / policy work package and were not used.

## 4. Architecture before code (the C6 seams as they really were)

- `mind/evaluation.ts`: `EVIDENCE_CLASSES` already had `EXTERNAL_OUTCOME`; `EXTERNAL_OUTCOMES_AVAILABLE = false` blocked
  definitions requiring it; `WorkEvidence.failures.external` was hard-coded `0` in `storage/improvement-core.ts`.
- `storage/outcome-core.ts`: `assertOutcomeClasses` refused the class by the flag, for both the Founder
  (`ImprovementStore.verifyOutcome`, the `OUTCOME_VERIFY` preview) and the Review Pool (`review-core` judgments).
- Migration 0010: `NOT LIKE '%EXTERNAL_OUTCOME%'` CHECKs on `outcome_verifications` and `review_outcome_judgments`.
- `mind/reporting.ts`: an unconditional `EXTERNAL_OUTCOMES_UNAVAILABLE` claim; `inspect(COMPANY)` returned the flag.
- The outbox (`events`) admitted six aggregate types by CHECK; C3–C6 had added no aggregate.
- Founder authority: `founderAdminWrite` + `founder()` (fails closed outside an authenticated session), and the C5
  governed confirmation (`founder_action_previews`, intent CHECK) for decisions reachable in production.
- Verifier: `c6-external-outcomes-unavailable` pinned the flag until a C7 closure record; `no-app-ops-implementation`
  forbids the APP-OPS name in code.

Design consequence: replace the flag by durable truth, keep ONE usable-evidence predicate shared by every seam, re-check
it in the datastore, and change nothing about who may verify (D-C7A-02 / 03).

## 5. Source / evidence model

- **Sources** (`external_sources`): stable key (`^[a-z0-9][a-z0-9.-]{2,63}$`), lane, family (`APP_OPERATIONS` or one of
  `SEARCH`, `WEB_ANALYTICS`, `APP_STORE`, `BUSINESS`, `CAMPAIGN`, `SOCIAL`, `APP_HEALTH`), state DRAFT / ACTIVE /
  SUSPENDED / RETIRED, Founder refs, history (`external_source_history`), no credential column.
- **Contracts** (`external_source_contracts`): `ops.events@1` (15 event types covering all 14 frozen domains) and
  `outcome.metrics@1` (28 provider-neutral metrics across the 7 families), each field declared with a bounded shape,
  units fixed by the contract, pinned per source by the SHA-256 of the canonical definition (drift fails closed).
- **Records** (`external_records`): canonical id; source and contract; producer event id; lane; type; domain;
  `occurred_at` (producer) vs `received_at` (Company); scope, window, value and unit (outcome lane); normalized declared
  scalar fields; `user_scoped`; `failure_signal`; fingerprint; status `ACCEPTED`. Referenced as `external_record:<id>`.
- **Conflicts** (`external_record_conflicts`): the same identity with another fingerprint — recorded, never applied.
- **Bindings** (`external_evidence_bindings` + history): Founder-only; `OUTCOME_EVIDENCE` (outcome lane → Work Item or
  Goal) or `DEPENDENCY_FAILURE` (failure-signalling operational fact → Work Item); revoke / supersede keep history.

## 6. Privacy model (Rules A / B / C)

Allowlist first; refusal by reason code before anything reads the envelope; forbidden names at any depth (private
content, credentials, raw payloads, bags); no whitespace in any value (raw error text and free text cannot pass); secret-
shaped values refused; unknown fields refused; arrays refused; size / depth bounded. A refusal is audited in its own
transaction with the reason code and at most a DECLARED field name — never a fragment of the occurrence (proof 18 asserts
the audit details' exact shape). No raw payload is stored; the datastore refuses any undeclared, non-scalar or free-text
field. A user diagnostic's pseudonym is fingerprint material only — never stored, never readable; per-user facts are an
aggregate count; there is no per-user lookup, search or browsing method (proof 19 pins the store's whole surface).
Ratings enter only as aggregates. Nothing reaches Memory, Analysis, World, Employee context or any App store.

## 7. Idempotency / provenance

Identity = (source, producer event id); fingerprint = SHA-256 of the canonical normalized identity (key order
irrelevant). Exact replay → `DUPLICATE`, canonical record returned, nothing written. Different fingerprint →
`INTAKE_CONFLICT`: conflict row (once per distinct fingerprint), audit (every time), outbox event; the first record
stands and stops being usable evidence; a source integrity conflict reaches Founder Attention (URGENT). Out-of-order
delivery accepted; a future occurrence beyond 5 minutes' skew refused. Restart preserves everything (proof 35).

## 8. C6 integration

`External evidence → Outcome Verification → C6 Evaluation → Attribution → Learning / Performance / Reporting`:
- **Verification** (both verifier paths, unchanged authority): `EXTERNAL_OUTCOME` exactly when `external_record:` refs are
  cited and each is usable for the verified Work Item (outcome lane, ACTIVE source, unconflicted, ACTIVE Founder
  `OUTCOME_EVIDENCE` binding to it). Codes: `EXTERNAL_OUTCOME_UNAVAILABLE`, `EXTERNAL_EVIDENCE_MISSING`,
  `EXTERNAL_EVIDENCE_UNDECLARED`, `UNKNOWN_RECORD`, `NOT_OUTCOME_EVIDENCE`, `SOURCE_NOT_ACTIVE`, `RECORD_CONFLICTED`,
  `NOT_BOUND_TO_WORK_ITEM`. A pool reviewer's judgment citing unusable evidence is not recorded
  (`OUTCOME_EVIDENCE_INVALID`); at resolution the pool's cited evidence is re-checked and, if no longer usable, the
  outcome is INCONCLUSIVE (`review_keys.external_evidence_unusable`) and reaches the Founder.
- **Evaluation**: the evaluator sees `EXTERNAL_OUTCOME` and cites the records only from such a verification;
  `failures.external` counts Founder-bound dependency failures of ACTIVE sources; attribution rules are unchanged (a
  bound dependency failure proposes `EXTERNAL_DEPENDENCY`, never the Employee; a negative result alone is a PROPOSED
  cause nothing counts until an independent decision).
- **Eval Registry**: a definition may require `EXTERNAL_OUTCOME` only while a governed source is active.
- **Reports / inspection**: three truthful states with canonical refs; Work Item and Goal inspection list bound
  evidence with a `usable` flag; Company inspection returns availability.
- **Attention**: only a source awaiting activation and a source integrity conflict.

## 9. Schema / migration

`0012_c7a_operational_data_external_outcomes.sql` (pinned `79255b4d…`): 7 STRICT tables with forward-only / append-only
triggers; the governed triggers `external_records_governed_source`, `external_records_fields_declared`,
`external_evidence_bindings_governed`, `outcome_verifications_external_evidence_governed`,
`review_outcome_judgments_external_evidence_governed`; row-preserving rebuilds (D-C4-01 naming, rows copied back before
the triggers) of `outcome_verifications`, `review_outcome_judgments`, `events` (aggregate `external_source`) and
`founder_action_previews` (four structured intents). 0001–0011 untouched. An existing Company upgrades only through
safe-upgrade (the runtime start path proves v11 → v12; proof 32 proves rows, `seq` order and triggers).

## 10. Tests and mutation matrix

| Suite | Marker | Tests |
|---|---|---|
| `governance/test/c7a-intake.test.ts` | `C7A-PROOF: intake-kernel` | 8 (allowlist, refusal matrix, units, windows, pseudonym, contracts, lifecycle, role matrix) |
| `storage/test/c7a-external-evidence.test.ts` | `C7A-PROOF: storage-external-evidence` | 42 (brief §18 items 1–35; 19 privacy cases) |
| `mind/test/c7a-kernel.test.ts` | `C7A-PROOF: c6-seam-kernel` | 2 (no flag; registry gate; report states; disclosed cut) |
| `runtime/test/c7a/c7a-runtime.test.ts` | `C7A-PROOF: runtime-c7a` | 1 (signalling contract; read-only CLI; no write command) |

`scripts/c7a-mutation-check.mjs` — 29 mutations (privacy ×6, source governance ×7, idempotency ×2, separation /
authority ×2, usable-evidence ×7, C6 seams ×5), all caught; CI shards Windows 1/2 + 2/2, Ubuntu 1/1, counted by the
quality gate. `c6-external-outcome-invented` keeps its id and targets the runtime gate. §18 items 36–40 are verifier
rules (`c7-later-scope-not-leaked`, `no-network-in-runtime-code`, `external-evidence-writes-confined`,
`c7a-intake-content-free`) plus the store-surface proof.

Verifier: `c6-external-outcomes-unavailable` → `external-outcomes-governed`; new `c7a-not-claimed-closed`,
`c7a-proofs-present`, `c7a-intake-content-free`, `external-evidence-writes-confined`, `c7a-extends-c6-only`,
`c7-later-scope-not-leaked`; 0011 frozen; 75 rules, each proved able to fail by the self-test.

## 11. Validation actually run

Focused, during implementation (failures classified before any change; all were proof / harness defects, none a
product defect — no production architecture changed to make a proof pass):
- `npm ci` once; builds and typecheck clean; ESLint clean on the changed packages and scripts.
- C7-A suites 8 + 42 + 2 + 1; nearest owners: governance 77, mind 116, domain 22, command-center 10, storage 220
  (C6 improvement / founder-free / resilience, C5 surface, R1 review, C4 review, migrations, C7-A), runtime 14
  (C5 / C6 incl. the v11 → v12 safe-upgrade start, C7-A) — all passing.
- `c7a:mutation` 29 / 29 caught; the retargeted `c6-external-outcome-invented` caught; verifier 75 / 75.

Final gate on the closure-candidate head: see §15.

## 12. Residuals / deferred

- **R-C7A-01** No live transport: `ingest` is an in-process seam; App-side production integration and L1 call it later.
- **R-C7A-02** Contracts are release code (`v1`); a new metric or event type is a new contract version (a release) and a
  Founder registration; adding a provider is only a source registration.
- **R-C7A-03** The four structured intents are reachable through the governed preview API (like R2-21's); no dedicated
  Command Center form (PG-04 parity).
- **R-C7A-04** Refusal audit rows are content-free but unbounded per misbehaving producer; rate limiting belongs to
  C7-B / L1.
- **R-C7A-05** Report relevance is "bound outcome evidence that occurred in the period"; objective windows, staleness
  and success thresholds belong to C7-C.
- **R-C7A-06** Suspending a source makes its evidence unusable for NEW verifications and removes its dependency
  failures from re-evaluated evidence; past verifications stand as history (re-verification is a Founder decision).
- **R-C7A-07** Per-user pseudonyms are not retained, so future automated per-user reliability processing needs its own
  governed design.
- **R-C7A-08** The migration's header comment names APP-OPS-01 (SQL comments are outside `no-app-ops-implementation`).

## 13. Handoff

- **C7-B (App control plane):** consumes `external_source` events and source health; adds no evidence semantics.
  Feature flags, kill switch, maintenance mode, rollout, minimum version, remote configuration and route holds stay
  absent (verifier).
- **C7-C (Pilot instrumentation):** registers real sources (families above), binds evidence to Pilot Goals / Work Items,
  and may add objective contracts with machine-verifiable criteria — through the same verification path.
- **C7-D (Marketing, website, social):** SEO / web / social / campaign metrics are already representable; publishing
  stays Founder-gated (D-C7A-01) and is not implemented.

## 14. No hidden claims

No App code, transport, listener, SDK, credential, control plane, publishing, campaign model, staffing, sixth Department
or Pilot was built; no real source exists and no data was invented. Strong v1 is not claimed. C7-A is not closed.

## 15. Final gate

(Recorded after the single full local `npm run ci` on the closure-candidate head; GitHub CI is the cross-platform gate.)
