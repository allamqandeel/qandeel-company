# C7-C Implementation Report — Pilot Instrumentation Pack

**Status:** IMPLEMENTATION CANDIDATE — NOT CLOSED. Ready for Technical Lead exact-head review only after the final
gate; no closure record is written before that review, the merge and post-merge proof. C7-D is not started.
**Branch:** `c7c/pilot-instrumentation-pack` from `main` @ `c06fd2e2f0e348efdfdc947322a80b69cf8ff088`.
**Decisions:** D-C7C-01 … D-C7C-12 in `docs/architecture/DECISION_LOG.md`.

## 1. Start gate (repository truth)

| Check | Result |
|---|---|
| Repository / default branch | `allamqandeel/qandeel-company`, `main` |
| `origin/main` | `c06fd2e2f0e348efdfdc947322a80b69cf8ff088` = expected (fetched with GitHub Desktop's signed Git; `gh` agrees) |
| PR #14 | MERGED 2026-10-01T13:40:53Z; final reviewed head `ddded00fbff1fb203d2dacc79c3083bc02f57c00`; merge commit `c06fd2e` (parents `e7ca688`, `ddded00`); head tree = merged tree `dd53656d…` |
| Run #97 (`36847418562`, PR head `ddded00`) | final conclusion SUCCESS on attempt 3 (attempt 1: Windows fault-matrix lease-timing flake + `r1-1of4` shard timeout; attempt 2: `tests (windows-latest)` re-run green; attempt 3: `r1-1of4` re-run green, `quality-gate` green); no code change |
| Run #98 (`36870478597`, push `c06fd2e`) | SUCCESS (fast-integrity path) |
| Working tree / toolchain | clean; Node 24.19.0, npm 11.17.0 (engines `>=24.11 <25`) |
| Migrations | 0001–0013 released and pinned; `docs/C7B_CLOSURE_RECORD.md` absent on the baseline (as the brief expected) |

No drift; no `AUTHORITY CONFLICT`. Read in full before design: `CLAUDE.md`, `README.md`, the implementation map,
`BOUNDARIES.md`, the decision log's C7 entries, the baseline, the implementation authority rules, Stage 8, 9, 14 and 17
(Stage 11 read for review independence), the C7-A / C7-B reports and closure records; the C5 Goal / communication, C6
evaluation / performance / learning, C7-A evidence and C7-B control code through the mechanism census (§5).

## 2. C7-B closure sync (first commit, `a98490d`)

`docs/C7B_CLOSURE_RECORD.md` (new, from GitHub truth): PR #14, reviewed head `ddded00`, run #97 final SUCCESS with the
same-head targeted reruns (Windows fault-injection / supervisor-lease timing flake; Windows `r1-1of4` mutation job timeout
— every mutation of that shard caught on rerun) and no production-code change, merge `c06fd2e` (same tree), post-merge
run #98 SUCCESS, the three TL corrections, **CLOSED / MERGED / CANONICAL**. A lifecycle note appended to the C7-B report
(narrative unchanged); implementation map (C7-B closed, C7-C active, C7-D not started), README, baseline and
`BOUNDARIES.md` synced; released 0013 joins the verifier's frozen migrations. No C7-B Product behaviour changed.

## 3. G1 — Skills

| Skill | Used | Concrete effect |
|---|---|---|
| `code-review` (high, on `main...HEAD` + working tree, before the final gate) | Yes | 6 findings, all fixed: (1) the shared C6 `liveEvaluations` applied its 5 000-row bound company-wide BEFORE the Work Item filter, so an older Pilot's (or Goal's) evidence could be crowded out — now filtered in SQL first (root-cause fix, also corrects `economics({goalId})`); (2) the palette opened the briefing thread with an empty employee id (lost CEO tether) — the API now returns `briefingEmployeeId`; (3) an N+1 state query in `completedNotVerified`; (4) the Pilot list built a full board per Pilot — new cheap `decisions()` read; (5) the latest-live-evaluation predicate was re-implemented — now reuses `LATEST_LIVE_EVALUATION`; (6) `SHOW_PILOT` shadowed `SHOW_GOAL` for a goal named with "pilot" — pattern moved, proof added |
| `security-review` | Invoked; could not run | Its pre-step shells out through the Bash tool, which exits on every command on this host. Checklist applied by hand: SQL fully parameterised (JSON id sets via `json_each(?)`); every Pilot read behind the verified session, every write through the Founder chokepoint and a confirm-once fingerprinted preview; titles secret-scanned at preview and store (a refused secret never enters the durable preview); audit carries ids / codes only; UI writes text via `textContent`. No finding |
| `sibawayh:designing-arabic-frontends` | Yes | Applied to the palette section: Arabic Pilot / goal titles rendered through the existing `content()` helper (own `dir`, Arabic line-height 1.8), `dir="auto"` on the title input, logical CSS only (`margin-top`, `gap`, `inset`-free), line-height 1.6 on the new form / decision lines, no letter-spacing / italics; Arabic `SHOW_PILOT` command forms (`اعرض التجربة`) in the classifier |
| `github-actions` | Read, not used | React Native simulator / emulator build pipelines — not applicable to this Node CI; CI sharding followed the repository's own quality-gate contract instead |
| `impeccable`, `ui-ux-pro-max`, `frontend-design`, `emil-design-eng` | Not used | The brief forbids a Tree of Light redesign; the surface is a minimal palette section in the existing design system |
| `simplify` | Not used separately | `code-review` at high effort covered reuse / simplification / efficiency (findings 3–5) |
| React Native / Expo / animation / document-format skills | Not used | Not applicable to a backend + Founder-surface work package |

## 4. Research refresh (D-C7C-11)

| Source | Finding | C7-C consequence |
|---|---|---|
| DORA metrics guide (dora.dev) | No single metric; context matters (cross-team comparison misleading); multiple measures with tension; metrics as targets invite gaming; improve over time rather than compete | Readiness is a checklist of independent criteria, never blended; people are listed by id, never ordered; no Employee comparison; activity is observability only |
| Anthropic, "Demystifying evals for AI agents" | Grade outcome AND transcript; combine grader types; errors compound across steps; grade what was produced, not a rigid path; read transcripts | Board = outcomes + `inspect` (trace refs into canonical lineage); C6's valid-creative-path rule kept; no step-checking grader added; failure localization across steps |
| OpenAI agent evals / trace grading | Traces reveal wrong tool choice, handoff and policy problems; move to repeatable evals once "good" is defined | Localization areas TOOL / HANDOFF / ESCALATION / REVIEW / …; repeatable Pilot evals wait for the Founder's definition of good (R-C7C-01) |

None is authority; no vendor infrastructure imported.

## 5. Pre-code mechanism census (what already existed and was reused)

| Need | Existing canonical mechanism reused |
|---|---|
| Founder ↔ CEO conversation, governed reply | C5 `communication_threads` / `communication_messages`, `txFounderSend` reply Work Items, the pending-reply predicate (`pendingRepliesOf`), `txOpenThread` |
| Root / Department Goals, Founder approval, Goal → Work | C5 `goals`, `goal_history`, `goal_work_links`, `GoalStore`, `GOAL_PROPOSE` / `GOAL_APPROVE` previews |
| Work lifecycle, lineage, ownership, delegation | C1 `work_items` (`parent_id`, `owner_ref`), C4 `work_delegations` |
| Review integrity | C4 `review_requests`, `review_decisions` (counting, reviewer ref), `review_conflicts` |
| Evaluation, profile, attribution, learning, economics | C6 `evaluation_results`, `liveEvaluations`, `attributionFacts`, `buildPerformanceProfile`, `costPerQualifiedOutcome`, `learning_signals` → `lessons` → `learning_interventions`, `systemic_findings`, `gatherWorkEvidence` |
| Real-world evidence | C7-A `latestVerdict` (current truth), `verificationExternalRefs`, `boundEvidence`, `externalAvailability` |
| Desired controls | C7-B `app_control_proposals` (read only) |
| Founder decisions / attention | C5 governed confirmation (`FounderActionStore`), Founder Attention items, the runtime signalling contract |

Not found anywhere (therefore added): a durable Pilot identity / mode / lifecycle, its two bindings, and the projection.

## 6. Architecture (simple language)

A Pilot is a labelled frame the Founder puts around real Company work. It remembers only who it is, which mode it is in,
which step it is at, which CEO conversation briefed it and which approved Company Goal it serves. Everything it shows is
read live from the systems that already own the facts. It decides nothing, grants nothing and scores nobody.

New code: `governance/src/pilot.ts` (lifecycle + intents), `mind/src/pilot-evidence.ts` (readiness, autonomy,
localization, market claim — pure), `storage/src/pilots.ts` (`PilotStore`), migration 0014, runtime `founder.pilots`,
API reads, `PILOT_CREATE` / `PILOT_ADVANCE` previews, `SHOW_PILOT`, a palette section.

## 7. Pilot lifecycle

`DRAFT → BRIEFING → READY → ACTIVE → REVIEWING → COMPLETED`, `STOPPED` from any non-terminal state; every step a Founder
act (code: `founder()` chokepoint + Founder-only check; datastore: history actor `founder:*`); forward only; terminal never
revives; mode, title and bindings immutable; append-only history; a repeated step is a no-op; one transaction per step
(state + history + audit, and the opened thread if any). No metric auto-closes a Pilot.

## 8. Founder briefing

The Founder starts BRIEFING (binding an open Founder ↔ CEO thread, or opening one with context `DECISION` /
`pilot:<id>`), then talks with the CEO through the existing C5 conversation: each REQUEST / QUESTION / DECISION_REQUEST
creates the CEO's governed reply Work Item. READY is offered (preview) and accepted (store + trigger) only once at least
one such request has a recorded governed reply; unanswered requests are shown as unanswered, never as consent. The reply
itself changes nothing — the Founder takes READY.

## 9. Goal / Work scope

ACTIVE binds one Founder-approved, ACTIVE Company Goal with success criteria (never created or approved by the Pilot).
Scope = root Goal → derived Department Goals → live Goal → Work links → their lineage (bounded, flagged when capped).
`GOAL_PROPOSE` now carries success criteria.

## 10. Evidence Board

Sections: Pilot / briefing / scope; outcomes; review integrity; Founder Attention in scope; decisions needed; people
(C6 profile per Employee on Pilot-scoped facts); appropriate autonomy (JUDGMENT + INDEPENDENCE classes with evaluation
refs); collaboration / handoffs (delegation records; message counts only under observability); learning; economics;
external outcomes and market claim; C7-B controls as desired-state context; advisory readiness checklist (8 criteria,
own state each). `inspect(pilot, workItem)`: outcome + canonical lineage refs + localization (blame only from a VALIDATED
C6 attribution).

## 11. C6 integration

No second evaluator: the board calls `buildPerformanceProfile` and `costPerQualifiedOutcome` on `liveEvaluations`
restricted to the scope (which now filters before its bound), attributions filtered to scope, learning effects and
contributions derived from the scope's learning signals. Eight dimensions only; C6 minimum sample / confidence / level /
trend / pending-attribution rules unchanged; one Pilot-only guard (D-C7C-06): an item whose JUDGMENT is NEGATIVE adds no
POSITIVE INITIATIVE.

## 12. C7-A integration

Training Pilots never claim market success. Controlled real-world Pilots: SUPPORTED only through qualified outcomes whose
current verification cites usable governed evidence; a late integrity conflict makes the claim CONTESTED immediately; the
Founder's C7-A resolution restores current truth; history kept. Absence of evidence is INSUFFICIENT unless the Pilot
requires it (then CONCERN). No intake endpoint, connector or scraper.

## 13. C7-B boundary

Issued proposals in scope appear as counts by state, `desiredStateOnly: true`, `countsAsOutcome: false`,
`appEffectKnown: false`; never an outcome, ACK, APPLIED or EFFECTIVE; no control family named outside C7-B; no transport.

## 14. Privacy / authority

Rule A: audit rows carry ids / states / codes (`pilot.created`, `pilot.<state>` with from / to / mode / thread / goal
ids); the title, message bodies and Goal text never enter audit / events / logs (proof 17 / 50). No private App content,
secret or score column (verifier). Titles secret-scanned. Pilot state ≠ authority; briefing ≠ approval; ACTIVE grants no
grant, budget or role (proof 11); readiness ≠ authority expansion; R3 / R4 untouched.

## 15. Migration 0014

`0014_c7c_pilot_instrumentation.sql` (pinned `adcd92ac…`): `pilots`, `pilot_history`, 11 datastore gates, two unique
binding indexes, and the row-preserving rebuild of `founder_action_previews` admitting `PILOT_CREATE` / `PILOT_ADVANCE`.
STRICT, no hard delete, forward-only, append-only history. 0001–0013 untouched (0013 now frozen). A released v13 Company
upgrades keeping every preview, audit and goal row (proof).

## 16. Proofs

| Suite | Marker | Tests |
|---|---|---|
| `governance/test/c7c-pilot-kernel.test.ts` | `C7C-PROOF: pilot-kernel` | 3 |
| `mind/test/c7c-pilot-evidence.test.ts` | `C7C-PROOF: pilot-evidence-kernel` | 9 |
| `storage/test/c7c-pilots.test.ts` | `C7C-PROOF: storage-pilots` | 15 |
| `runtime/test/c7c/c7c-runtime.test.ts` | `C7C-PROOF: runtime-c7c` | 1 |

28 tests covering the brief's 50 proof families (numbered in the test names), plus: the Founder chokepoint fails closed
for Pilot acts, the governed confirmation (preview never offers a refused step; confirm once), the v13 → v14 upgrade, the
signalling contract and restart on the real runtime, the decisions read agreeing with the board. Existing tests touched
only where a new migration exists (applied-version lists in `migrations`, `c7a`, `c7b`).

## 17. Mutations

`scripts/c7c-mutation-check.mjs`: 25 mutations (lifecycle code + datastore ×10, linkage ×2, evaluation integrity ×9,
C7-A / C7-B ×3, Rule A ×1) — 25 / 25 caught locally (136 s). Two first-run misses were real proof gaps and were closed by
strengthening the proofs (mode immutability is now proved on an allowed step; the Founder bypass now targets the
chokepoint call, the redundant `p.kind` check being defence in depth). CI: Windows 2 shards, Ubuntu 1, counted by the
quality gate.

## 18. Verifier

New rules: `c7c-requires-c7b-closure`, `c7c-not-claimed-closed`, `c7c-proofs-present`, `c7c-pilot-governed` (all 11
gates; only `pilots` / `pilot_history` created; no private / secret / score column; Pilot writes only in the store; no
runtime / CLI / surface call of the internal step writers; exactly 8 criteria; autonomy = JUDGMENT + INDEPENDENCE),
`c7c-no-c7d-or-network` (no network, no C7-D scope, no App-effect claim in C7-C modules); C7-C mutation ids pinned;
self-test proves each rule can fail and admits the legitimate states. 86 / 86 rules.

## 19. Focused validation (during implementation)

- C7-C: governance 3 / 3, mind 9 / 9, storage 15 / 15, runtime 1 / 1; mutation 25 / 25.
- Nearest regressions: full governance (94 → 95 with the new goal-read proof) and mind (126) suites; storage
  `c5-founder-surface`, `c6-improvement`, `c6-founder-free`, `c7a-external-evidence`, `c7b-app-controls`, `migrations`,
  `c7c-pilots` 170 / 170, re-run after the review fixes; Command Center 10 / 10; runtime `c5-founder-signal`,
  `c5-runtime`, `c7c-runtime` 9 / 9.
- `typecheck` clean; ESLint `--max-warnings=0` clean on `packages` and `scripts` (the git-ignored local `tmp/` probe
  folder from earlier stages is not part of the repository); verifier 86 / 86.

## 20. Final exact-head validation

The one final full local `npm ci` + `npm run ci` and the GitHub CI status run on the exact closure-candidate head; their
results are reported in the PR handoff, not here (writing them here would change the head they describe).

## 21. Residuals / deferred

- **R-C7C-01** Pilot success thresholds, objective windows and staleness (R-C7A-05) are a Founder / Product decision;
  C7-C states evidence only and invents no threshold.
- **R-C7C-02** Scope is capped at 2 000 Work Items (flagged `capped`); a larger Pilot needs paging.
- **R-C7C-03** The Board is computed per read (no snapshot); a periodic Pilot report through the C6 report path is later.
- **R-C7C-04** The INITIATIVE guard (D-C7C-06) applies inside Pilots only; whether C6's employee-wide profile should
  adopt it is a C6 Product decision.
- **R-C7C-05** No dedicated Pilot canvas / lens: the palette section is the minimal surface (no Tree of Light redesign).
- **R-C7C-06** A Pilot title cannot be corrected after creation (identity is immutable); stop and recreate.

## 22. C7-D handoff

C7-D — **Digital Presence Creation & Operations** (D-C7C-12): BUILD (research, sitemap / IA, UX, copy, visual
direction, code, tests, preview, SEO preparation) and OPERATE (updates, landing pages, SEO, content, social, marketing
operations, measurement, governed external publishing). Flow: broad Founder Goal → research → questions → strategy →
site structure → technical proposal → design / copy / code → tests → preview → Founder decisions → governed publication →
real results back through C7-A → C6 → C7-C (a CONTROLLED_REAL Pilot on that Goal). First external publication under the
QANDEEL name stays Founder-approved; no framework, hosting, CMS, analytics, SEO or social vendor preselected. Nothing of
C7-D is implemented here.

## 23. TL exact-head review correction (review of `2af37b6`, 1 MAJOR)

Finding: binding an existing CEO thread let an exchange from before the Pilot satisfy its READY gate. Fix (D-C7C-13): a
write-once `briefing_from_seq` boundary set entering BRIEFING (datastore-checked as the thread's next sequence); only
qualifying Founder requests at or after it count, in TypeScript and in the READY trigger; old messages remain history.
Proof: the TL's adversarial sequence (reused direct thread, pre-Pilot exchange refused in code and by direct SQL, including
moving the boundary back; a new governed exchange then makes READY succeed; old history intact). Mutations 25 → 27 (code
and datastore boundary). Focused validation: C7-C storage 16 / 16, C5 founder surface + migrations 32 / 32, runtime C7-C
1 / 1, C7-C mutations 27 / 27, verifier 86 / 86, typecheck and lint clean. Migration 0014 (unreleased) re-pinned
`9efb1a03…`. Nothing else reopened.

C7-C is NOT CLOSED.

## 24. Lifecycle note (appended at the C7-D start, 2026-10-01)

The narrative above is history and is not rewritten. After the Technical Lead's exact-head review of `7739a97`, PR #15
merged into `main` as `f450d6a427bf2687c9f9eb9fbb062d6ce4f36b68` (same tree `f298deda`); exact-head run #100 passed the
full Windows + Ubuntu gate on its first attempt and post-merge run #101 passed the fast-integrity path. The canonical
closure statement is `docs/C7C_CLOSURE_RECORD.md`: C7-C is CLOSED / MERGED / CANONICAL.
