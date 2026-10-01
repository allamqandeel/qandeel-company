# C7-B Implementation Report — Governed App Operations Control Plane

**Status:** IMPLEMENTATION CANDIDATE — NOT CLOSED. Ready for Technical Lead exact-head review only after the final
gate; no closure record is written before that review and the merge. C7-C and C7-D are not started.
**Branch:** `c7b/governed-app-operations-control-plane` from `main` @ `e7ca688f3a5ac2de5c317fbca31c5dad3dba2a41`.
**Decisions:** D-C7B-01 … in `docs/architecture/DECISION_LOG.md`.

## 1. Start gate (repository truth)

| Check | Result |
|---|---|
| Repository | `allamqandeel/qandeel-company` (`origin` https remote) |
| `origin/main` | `e7ca688f3a5ac2de5c317fbca31c5dad3dba2a41` = the expected baseline (fetched with GitHub Desktop's signed Git; `gh` agrees) |
| PR #13 | MERGED 2026-10-01T07:59:19Z from head `4decc904…`; merge commit `e7ca688`; PR head tree = merged tree `507ae100…` |
| CI | exact-head run #93 full Windows + Ubuntu SUCCESS; post-merge run #94 fast-integrity SUCCESS |
| Migrations | 0001–0012 released and pinned in `RELEASED_MIGRATIONS`; 0012 now also frozen by content in the verifier |
| Working tree | clean; task branch created from exact `origin/main` |

No drift from the expected baseline; no `AUTHORITY CONFLICT` was found (§2).

## 2. Authority read

`CLAUDE.md` order: README; baseline (Rules A / B / C); the authority index; Stage 3 (risk ladder, R3 trust-building,
maker / reviewer separation, approval semantics — "where action arguments materially change, prior approval is not
reusable"); Stage 10 (Product Department, App Store Release & Reputation Lead §10, Director authority is explicit §8,
acting coverage §25); Stage 14 (deny by default, grants at the action boundary, no secrets in SQLite, natural language
is untrusted); `IMPLEMENTATION_AUTHORITY_RULES.md`; implementation map; `BOUNDARIES.md`; the brief.

The App-side APP-OPS-01 contract was read **read-only** from `allamqandeel/qandeel` (`docs/p4/APP_OPS_01_…md`, status
`CLOSED / FROZEN`, and the P4-C2 decision record). It agrees with the brief on every point C7-B touches: §10.1
(approved families only, explicit scope, runtime-held effective state, an outage is never a control, versioned and
audited), §10.2 (controls may only restrict; never manufacture consent, privacy, ownership, truth or entitlement;
never rewrite history), §11 (the seven families and their definitions; Rollout = cohort-scoped `INTERNAL` /
`LIMITED_ROLLOUT` / `ENABLED`, no percentage), §12 / PO-OPS-19 (no generic remote execution; code delivery is a
release), §14 (Route Hold is negative only; never selects, ranks, forces or changes FAST / DEEP), §15 (failure
semantics), §16 / PO-OPS-09 (the App Operations & Release Lead under the Product Director), PO-OPS-18 (no initial
Remote Configuration family is frozen). No App file was written. Stage 16 remains missing and was not reconstructed.

## 2a. Skills used

| Skill | Concrete effect |
|---|---|
| `code-review` (high, on `main...HEAD` + working tree, before the final gate) | 7 findings: a REJECT of a control approval was blocked by the preview whenever the act was no longer issuable (fixed: only APPROVE requires issuability; the preview states the review as it is; proof added); `proposals()` filtered after its LIMIT (fixed: SQL filter); the Product charter version took the SQLite wall clock instead of Company time (fixed: the latest audited Company instant, never before the superseded version); an already-rejected act was recorded STALE (fixed: REJECTED with that approval); the proposal trigger ignored grant expiry / uses (fixed); a STALE proposal's open review and the two aggregate ids of `app_control` events were kept as residuals (R-C7B-07, R-C7B-09) |
| `security-review` | Invoked, but could not run on this host (its pre-step shells out through the Bash tool, which exits on every command here). Its checklist was applied by hand instead: the only issuing path is the Founder's `decideApproval` of an approval whose action is `app-control.issue` — no other code path can create such an approval (tool approvals carry `tool:*` actions, Work Item approvals `work_item.execute`), and the hook refuses an approval with no awaiting proposal; the grant resource is derived from the same family the kernel validates; nothing in C7-B stores a secret, key or signature, executes, spawns, imports dynamically or opens a network path (verifier rule `c7b-no-generic-execution`). No finding |
| `code-review` (TL-correction cycle, on the D-C7B-09 / D-C7B-10 working-tree diff) | 1 finding, fixed: the bounded recovery sweep selected stranded control proposals without requiring an ACTIVE plan, so proposals that can only wait for a plan could fill its LIMIT every sweep and starve a recoverable one; the sweep now selects only Work Items with an ACTIVE plan |

The other available skills (React Native, animation, UI design, document / slide formats, Arabic copy) do not apply to a
backend governance / storage work package and were not used.

## 3. External engineering references (informative only)

- **OpenFeature** (typed evaluation: boolean / number / string / structure, a mandatory caller default, evaluation
  context). Conclusion: values must be typed and bounded; the *consumer* owns the safe default when a control is absent.
  Not adopted: evaluation context / targeting (it would carry user attributes — forbidden here), structure values, SDKs.
- **AWS AppConfig** (validators run before a deployment proceeds; versioned configurations; revert to a previous
  version as a new deployment). Conclusion: validate before anything is issued (kernel + datastore), keep immutable
  versions, and model "undo" as a new revision (RELEASE / a new SET), never as an edit. Not adopted: automatic
  alarm-driven rollback (no monitoring event may issue a control), deployment strategies, vendor SDKs.
- **Declarative control planes** (desired state is recorded separately from observed / effective state). Conclusion:
  C7-B records only *issued (desired)* state; there is no observed / applied state at all until authenticated App-side
  evidence exists.

None of these is Product authority; no dependency was added.

## 4. Architecture before code (the real seams)

- **Authority** (`governance/authority.ts`): `decideEmployeeAction` already returns, for R3, `ALLOW` with
  `review: INDEPENDENT` AND `approval: FOUNDER` (cumulative gates); `CAPABILITY` is a closed grammar; grants with an R3
  ceiling are Founder-created C2 grants (`GovernanceStore.grant`), while Founder delegation (`delegateAuthority`) only
  ever creates R1 organizational grants.
- **Employee acts** (`storage/org-writes.ts` `txOrgAct`): fenced, idempotent per (Work Item, step), grant decision at
  the action boundary, containment on denial, seat eligibility in the act, content-free audit; reached from a run as an
  `ORG_ACTION` proposal (no runtime change needed).
- **Independent review** (`review-core.ts` `actionReviewGate` / `ensureRequest`): an ACTION subject reviewed under the
  Work Item's Review Plan by the qualified Review Pool, keyed by an exact fingerprint; a REWORK of that fingerprint is
  final; the maker is excluded; conflicts and escalations already reach the Founder.
- **Founder approval** (`approvals`, `upsertApprovalRequest`, `decideApproval`): fingerprint-scoped, durable, a
  rejected scope never silently regenerates, R3 decided by the Founder only; Founder Attention already lists pending
  R3 approvals; the C5 governed confirmation already has `APPROVAL_DECIDE`.
- **Outbox** (`events`, aggregate CHECK) and **audit** (`audit_events`), both content-free.
- **Organization** (0007): canonical seats are release-seeded (`source = CANONICAL_MAP`); charters are versioned and
  superseded, never edited.
- **C7-A** (`external-evidence.ts` `ingest`): every refusal (and every repeated conflicting replay) appends one audit
  row — R-C7A-04.

Design consequence (D-C7B-02): **no new approval, review, confirmation, audit or event system.** A control revision is
an R3 Employee act (`control.propose`) that rides the existing org-act boundary, opens the existing action review, is
put to the Founder as an ordinary R3 approval once the review is satisfied, and is issued in the transaction that
consumes that approval. The only new intent surface is the decision-ready description the existing `APPROVAL_DECIDE`
preview shows for a control approval.

## 5. Desired ≠ effective

C7-B knows what the Company **issued**; it does not know what the App applied. The only Company state of a revision is
`ISSUED` (a datastore CHECK); there is no applied / acknowledged / delivered / effective column, state or table, and the
export is named and typed as Company-issued desired controls. App-side Production Integration owns authentication,
applicability, effective state, last-known-good, TTL and enforcement.

## 6. C7-A closure sync (first commit)

`docs/C7A_CLOSURE_RECORD.md` (new): PR #13, reviewed exact head `4decc904…`, exact-head run #93 SUCCESS, merge
`e7ca688f…` (same tree `507ae100…`), post-merge run #94 SUCCESS (fast-integrity), the three Technical Lead corrections
(late integrity conflict / current truth, datastore contract enforcement, contested pattern reuse), **CLOSED / MERGED /
CANONICAL**, residuals handed on. Implementation map (C7-A closed, C7-B active), README, baseline §6 and `BOUNDARIES.md`
lifecycle wording synced; a lifecycle note appended to the C7-A report (narrative unchanged); 0012 joins the verifier's
frozen migrations. C7-A was not reopened.

## 7. The App Operations & Release Lead seat

Migration 0013 creates `product.app-operations-release-lead` — "QANDEEL App Operations & Release Lead", LEAD, Product
Department, reports to the Product Director seat, `CANONICAL_MAP`, ACTIVE, **vacant** — and a new Product charter
version (v2) listing it (v1 superseded, never edited; BASELINE stays BASELINE). The App Store Release & Reputation Lead
seat is unchanged and separate. No Employee, assignment, persona, model or grant is created. Acting coverage uses the
existing acting-assignment rules (its scope must name `control.propose`, or be the seat's whole remit). D-C7B-05.

## 8. Control model

- **Series** — one family on one exact canonical scope; immutable identity (`app_control_series`).
- **Proposal** — the exact act an Employee proposed (`app_control_proposals`): family, scope, operation (`SET` /
  `RELEASE`), typed value, reason code, evidence refs, the revision it expects, its fingerprint, the proposer, seat,
  grant, run and Work Item, its review request and approval. PROPOSED → AWAITING_FOUNDER → ISSUED | REJECTED;
  PROPOSED → REVIEW_REJECTED; PROPOSED / AWAITING_FOUNDER → STALE. Forward-only, history kept.
- **Revision** — append-only Company desired state (`app_control_revisions`): series, revision n (n-1 = the prior,
  compare-and-swap), family, scope, operation, normalized value, reason, proposal, proposer ref, review request,
  approval, issuing Founder, issue time, digest, `company_state = ISSUED`.
- **Idempotency / concurrency** — the same act from the same Work Item returns the live proposal or the issued revision
  (no second review, approval or revision); a changed act is a new fingerprint; a stale expected revision is refused at
  proposal and again at issue (code and datastore); issuing one revision stales every concurrent proposal of the series
  and revokes its pending approval; an identical SET is no change; RELEASE needs a live SET.

## 9. The seven families (kernel `governance/src/app-controls.ts`, re-checked by `app_control_revisions_conform`)

| Family | Scope kinds | SET value | RELEASE |
|---|---|---|---|
| Feature Flags | CAPABILITY | `state` ∈ DISABLED, INTERNAL, LIMITED_ROLLOUT, ENABLED, EMERGENCY_DISABLED | removes the Company flag overlay |
| Kill Switch | CAPABILITY | `effect` = OUT_OF_SERVICE | removes the emergency restriction |
| Maintenance Mode | APP, CAPABILITY, SURFACE | `reason` ∈ six operational codes (no user copy) | ends the Company maintenance overlay |
| Rollout Control | COHORT (capability + one opaque cohort) | `exposure` ∈ INTERNAL, LIMITED_ROLLOUT, ENABLED (no percentage) | removes the rollout overlay |
| Minimum Supported Version | PLATFORM, PLATFORM_CAPABILITY | `minVersion` canonical `MAJOR.MINOR.PATCH` | removes the Company floor |
| Approved Remote Configuration | per approved family (APP / CAPABILITY / SURFACE) | `{ family, value }` typed by the approved family — **register empty: fails closed** | removes the overlay |
| Model / Provider Route Hold | PROVIDER, ROUTE | `hold` = HELD (negative only) | removes the hold |

Scope identifiers are short opaque codes (no user / account / conversation identifier, e-mail, phone, UUID-like key,
selector or expression). Every object is an exact allowlist; an unknown key is refused and named as generic execution
(code, script, SQL, command, expression, prompt, URL, payload…), private content (user, conversation, transcript,
memory, message…) or selection (model, fallback, FAST / DEEP, force…). A less restrictive revision or a RELEASE only
removes Company restriction — the App runtime intersects it with its own Product, launch, entitlement and Safety
authority; the Company never claims a user was blocked, upgraded or routed.

## 10. R3 authority integration

`proposed → independently reviewed → Founder approved → issued`, through the existing boundaries (D-C7B-02): the org-act
boundary decides `control.propose` at R3 on the family's grant resource (`app-control.issue`, an R3 Founder-created
grant; never an organizational capability, so never delegable or self-granted) plus the seat; the action review is the
Review Pool's, bound to the act's fingerprint (no plan → refused; the maker is excluded); a satisfied review creates the
PENDING R3 approval; the Founder decides it through `APPROVAL_DECIDE` (decision-ready preview: family, scope, operation,
value, from → to, reason, evidence, review status, risk) and approval issues in the same transaction. Founder
Attention: the pending R3 approval (NEEDS_DECISION), and the existing review-conflict / escalation items; normal
history adds nothing. A telemetry failure or outage never issues a control.

**Issue-time authority (D-C7B-09, TL MAJOR 1).** Authority is re-decided where the act takes effect: the issue
transaction (and the governed APPROVE preview) re-checks that the proposer may still act, still holds the seat it
proposed from or acting coverage naming `control.propose`, and that the very grant the act was decided under is still
ACTIVE, unexpired, R3 and covering the family. Its `uses` is not re-tested (consumed by this act at proposal time).
A refusal is whole (`AUTHORITY_DENIED` + reason; nothing issued or decided); the Founder may still reject. The
datastore re-checks it (`app_control_revisions_authority_current`).

**Review Plan supersession (D-C7B-10, TL MAJOR 2).** A control review that goes STALE revokes any approval PENDING on
it and returns the proposal to PROPOSED; the same proposal is then bound to a fresh review of the same exact act under
the active plan (never a duplicate proposal, never a new Work Item, never the stale review again); only after that
review passes does a new approval exist, and only it issues. A rework-rejected act is never revived; a moved series or
an ended Work Item makes the act STALE; without a plan reviewing actions it waits for the next plan (or the sweep).

## 11. Migration 0013

`0013_c7b_governed_app_controls.sql` (pinned): the seat and charter version; `app_control_families` (seven rows,
closed); `app_remote_config_families` (empty, release-only); `app_control_proposals` + history; `app_control_series`;
`app_control_revisions`; `external_intake_refusal_windows` (+ history fold-in from the audit); the row-preserving
rebuild of `events` adding the `app_control` aggregate. After the TL exact-head review (still unreleased, re-pinned): `app_control_revisions_authority_current` (issue-time seat + current grant) and the forward-trigger rules of D-C7B-10 (review / approval replaced only once STALE / REVOKED; AWAITING_FOUNDER only on a SATISFIED review and a PENDING approval). All STRICT, no hard delete, append-only history, forward-only
updates; state, history, audit and outbox commit in one `BEGIN IMMEDIATE`. 0001–0012 untouched. An existing Company
upgrades only through safe-upgrade (proof 3 proves v12 → v13 rows, outbox, charter history and refusal fold-in).

## 12. Outbound seam

`AppControlStore.issuedControls()` → `{ contract: 'company.issued-controls@1', controls, digest }` — the current
revision of every series (a RELEASE included), ordered by family then scope; each envelope carries exactly
`seriesId, revision, family, scope, operation, value, issuedAt, digest, companyState: ISSUED`. Outbox events
(`app_control.proposed`, `.proposal_changed`, `.revision_issued`) carry ids, codes and digests only. No transport.

## 13. C7-A refusal amplification guard (R-C7A-04, Company side)

See D-C7B-07: per (registered source or `unresolved`, reason code, hour) counters; the first refusal of a window is
audited, the rest counted; the same for repeated conflicting replays; 200 different attacker source keys produce one
counter and one audit row (proof 60–63). **Network / WAF / edge rate limiting is not implemented and not claimed.**

## 14. Proofs and mutation matrix

| Suite | Marker | Tests |
|---|---|---|
| `governance/test/c7b-controls.test.ts` | `C7B-PROOF: control-kernel` | 14 (catalogue, scopes, each family, Remote Configuration, Route Hold, no generic execution / private content, fingerprints, revision law, R3 decision, envelope keys) |
| `storage/test/c7b-app-controls.test.ts` | `C7B-PROOF: storage-control-plane` | 28 (brief §32 items 1–65, grouped; plus 5 issue-time authority proofs (D-C7B-09) and 4 Review Plan supersession proofs (D-C7B-10)) |

`scripts/c7b-mutation-check.mjs` — 42 mutations (catalogue ×2, R3 seat / grant / review / approval ×9, exact act and
revision law ×8, datastore contract ×7, kernel guards ×4, issue-time authority ×5, stale review / approval ×4, outbox and refusal bound ×3), pinned in the verifier; CI shards
Windows 1/3 … 3/3, Ubuntu 1/2 + 2/2, counted by the quality gate. Verifier: six new rules plus the narrowed
`c7-later-scope-not-leaked`; 81 rules, each proved able to fail by the self-test.

Not mechanically provable here and stated instead: "the maker cannot be the sole reviewer" is the Review Pool's existing
exclusion (C4 proofs and mutation `c4-self-review-allowed`); C7-B asserts the control review's assignments never include
the proposer and adds a datastore clause refusing a revision whose counting review decision was the maker's.

## 15. Validation

Focused validation during implementation (QUALITY COMPLETE, VALIDATION PROPORTIONAL TO CHANGE):
- `storage/test/c7b-app-controls.test.ts` — 28/28 (the 19 original + 5 issue-time authority + 4 Review Plan supersession proofs).
- Nearest regressions (shared review / approval / migration code): `migrations`, `c4-review`, `r1-review`,
  `c4-organization`, `c2-governance`, `c3-review-fixes`, `c7a-external-evidence` — 192/192.
- The 9 new mutations (`--only`) — 9/9 caught; every existing mutation anchor in the touched files still applies
  exactly once.
- Verifier 81/81 rules, self-test 80 rules each able to fail; `typecheck` clean; `eslint --max-warnings=0` clean.

The one final full local `npm run ci` (build, typecheck, lint, every workspace test, every mutation suite c1 … c7b,
verify) runs on the exact closure-candidate head; its result and the GitHub CI status of that head are reported in
the PR handoff, not here (writing them here would change the head they describe).

## 16. Residuals / deferred

- **R-C7B-01** No transport, App consumer, signing, authentication, TTL, last-known-good, App-side retention or
  application: App-side Production Integration / Security. A digest is not authentication.
- **R-C7B-02** No App acknowledgement / applied evidence model: only authenticated App-side evidence may add one.
- **R-C7B-03** No Approved Remote Configuration family exists; a later controlled Product + Architecture release adds
  one (code register + a migration re-creating the release-only guard).
- **R-C7B-04** Maintenance has no planned window (TTL-like semantics would pretend expiry is solved); user-facing
  maintenance / upgrade moments belong to the End-to-End audit.
- **R-C7B-05** Network / edge rate limiting of intake: L1 / Production Integration (C7-B bounds only Company storage).
- **R-C7B-06** No dedicated Command Center form for control decisions: the Founder decides through the existing
  `APPROVAL_DECIDE` confirmation (structured preview); no UI redesign.
- **R-C7B-09** `app_control` outbox events use the proposal id as aggregate id for proposal events and the series id for
  `revision_issued` (the proposal id is the correlation id of both); a later consumer joins them by correlation id.
- **R-C7B-07** (the plan-supersession part is resolved by D-C7B-10) A proposal made STALE by another issued revision keeps its open action review until a reviewer
  decides it (the decision then changes nothing); cancelling such reviews needs a Review Pool withdrawal path for ACTION
  subjects.
- **R-C7B-08** Standing / delegated R3 authority for specific control categories is a later explicit governed
  delegation; none exists.

## 17. Handoff

- **App-side Production Integration** (`allamqandeel/qandeel`): authenticated transport and consumer of
  `company.issued-controls@1`, canonical App effective state, intersection with Product / launch / Safety authority,
  signing, stale / TTL / last-known-good, receipt / application evidence, enforcement and the user-facing moments.
- **C7-C**: consumes C7-A real outcome evidence and C7-B governed controls to make Pilot 1 measurable; an issued control
  is never an outcome.
- **C7-D**: Marketing / Website / Social stays separate and Founder-publish-gated.

## 18. No hidden claims

No App code, transport, listener, SDK, credential, key, signature, applied state, real Kill Switch, maintenance or
upgrade screen, provider routing, model selection, OTA, Pilot instrumentation, publishing, dashboard, Department or
Employee was built. C7-B is NOT CLOSED.