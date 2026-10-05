# C7-D Implementation Report — Digital Presence Creation & Operations

**Status:** IMPLEMENTATION CANDIDATE — NOT CLOSED. Ready for Technical Lead exact-head review only after the final gate;
no closure record is written before that review, the merge and post-merge proof.
**Branch:** `c7d/digital-presence-creation-operations` from `main` @ `f450d6a427bf2687c9f9eb9fbb062d6ce4f36b68`.
**Decisions:** D-C7D-01 … D-C7D-12 in `docs/architecture/DECISION_LOG.md`.

C7-D builds the Company's **capability** to create and operate QANDEEL's digital presence. It does **not** build the
QANDEEL website, create its repository, choose a framework, hosting provider, CMS, analytics, SEO vendor or social
platform, buy a domain, touch DNS, publish anything or post anything.

## 1. Start gate (repository truth)

| Check | Result |
|---|---|
| Repository / default branch | `allamqandeel/qandeel-company`, `main` |
| `origin/main` | `f450d6a427bf2687c9f9eb9fbb062d6ce4f36b68` = expected (fetched with GitHub Desktop's signed Git; `gh` agrees) |
| PR #15 | MERGED 2026-10-01T16:49:34Z; reviewed head `7739a97a85cec0f63b516108acca8b6768b5c97b`; merge `f450d6a` (parents `c06fd2e`, `7739a97`); head tree = merged tree `f298deda…` |
| Run #100 (`36889372374`, PR head `7739a97`) | SUCCESS, first attempt |
| Run #101 (`36894883451`, push `f450d6a`) | SUCCESS (fast-integrity path) |
| Working tree / toolchain | clean; Node 24.19.0, npm 11.17.0 (engines `>=24.12 <25`, `>=11.6 <12`) |
| Migrations | 0001–0014 released; `docs/C7C_CLOSURE_RECORD.md` absent on the baseline (as the brief expected) |

No drift; no `AUTHORITY CONFLICT`. Read before design: `CLAUDE.md`, `README.md`, the implementation map, `BOUNDARIES.md`,
the decision log's C7 entries, the baseline, the implementation authority rules, Stages 3, 7, 8, 9, 11, 12, 14, 15 and 17
in full, the C7-B / C7-C reports and closure records, and the Artifact Store, Tool Registry / grants / approvals / Tool
Executor / credential references, Founder confirmation, Review Pool, calendar and C7-C board code (mechanism census, §5).

## 2. C7-C closure sync (first commit, `3d9c9fd`)

`docs/C7C_CLOSURE_RECORD.md` (new, from GitHub truth): PR #15; first TL-reviewed head `2af37b6`; the TL MAJOR (a stale,
historical CEO conversation could satisfy a later Pilot's briefing); correction head `7739a97` (the immutable
`briefing_from_seq` boundary; mutations 25 → 27); exact-head run #100 SUCCESS; merge `f450d6a` (same tree); post-merge
run #101 SUCCESS; **CLOSED / MERGED / CANONICAL**. A lifecycle note appended to the C7-C report (narrative unchanged);
implementation map, README, baseline and `BOUNDARIES.md` synced; released 0014 joins the verifier's frozen migrations (the
synthetic base carries the C7-C proofs and the C7-B record it now requires). No C7-C Product behaviour changed.

## 3. G1 — Skills

| Skill | Used | Concrete effect |
|---|---|---|
| `code-review` (high, `main...HEAD`, before the final gate) | Yes | 7 findings; fixed: (1) a driver refusal after approval (`RETRYABLE`) was derived as "Under independent review" — now FAILED, with a kernel proof; (2) a missing social window was refused as "window passed" — now SCHEDULE_WINDOW_INVALID; (3) the promotion's review was found by re-deriving its fingerprint from guessed data classes and the preparer's ref — now matched exactly by the arguments the review subject records; (4) the manifest was recomputed on every promotion view — the cheap view uses the immutable revision's hash, the export resolution still recomputes it; (5) the decision log lacked the C7-D entries — D-C7D-01…12 written; (6) objects were stored before the ownership check — ownership / state are now checked before any put. Kept as residual: (7) export replay after a human push to the candidate branch fails closed (R-C7D-07) |
| `security-review` | Invoked; could not run | Its pre-step shells out through the Bash tool, which exits on every command on this host. Checklist applied by hand, and in the proofs: no generic execution surface; all SQL parameterised (JSON id sets via `json_each(?)`); secrets refused in content, titles and summaries and never in audit / events / tool history; drivers get no store, path or credential value; tokens never in results; a closed GitHub endpoint allowlist; the Preview sandboxed on another site with no cookies; untrusted text rendered via `textContent` |
| `github-actions` | Read, not used | React Native simulator / emulator build pipelines — not applicable; the CI shards follow the repository's own quality-gate contract |
| `sibawayh:designing-arabic-frontends` | Read, light effect | The palette section renders Company titles / summaries through the existing `content()` helper (own `dir`, Arabic line-height); the Arabic `SHOW_DIGITAL` forms (`اعرض الموقع`, `الحضور الرقمي`) follow the classifier's normalized spelling |
| `impeccable`, `ui-ux-pro-max`, `frontend-design`, `emil-design-eng` | Not used | The brief forbids a Tree of Light redesign; the surface is one minimal palette section in the existing design system |
| SEO / content / API-integration skills | None installed | `SearchSkills` for SEO, content, security, accessibility, API integration and mutation testing returned nothing |
| React Native / Expo / document-format skills | Not used | Not applicable |

## 4. Research refresh (D-C7D-12)

| Source | Current fact | C7-D consequence |
|---|---|---|
| GitHub: deciding when to build a GitHub App; installation tokens | Apps give fine-grained permissions, per-repository installation and ~1-hour tokens that can be narrowed by `repositories` / `permissions` | Fresh token per call, one repository, exactly five permissions; no PAT (D-C7D-08) |
| GitHub: permissions required for Apps | Contents: write covers blobs / trees / commits / refs and the merge endpoint; PRs need Pull requests: write; checks / statuses read; branch-protection reads need Administration, effective rules need only Metadata | `contents`, `pull_requests`, `checks`, `statuses`, `metadata`; rules read through `rules/branches` |
| GitHub: protected branches / rulesets; merge API | Required checks / reviews protect branches; rulesets are the current model; merge `sha` makes a moved head fail with 409; `mergeable_state` unknown while computing | Merge only when `clean` + green, with the `sha` guard; unknown fails closed |
| GitHub: API versions | `2022-11-28` supported until 2028-03-10; `2026-03-10` exists | Pinned `2022-11-28` with its sunset; fail closed after it |
| Vercel / Cloudflare Pages docs (patterns only) | Preview ≠ production; immutable per-commit previews; access-protected, noindex previews; promote the verified artifact; rollback to a prior production artifact | Distinct hosting acts; exact candidate; rollback bound to the current version; no vendor chosen |
| Google Search Central (starter guide, developer guide, JS SEO, sitemaps, canonical, noindex, Search Console API) | Crawlable `<a href>` links, canonical is a hint, noindex must be crawlable, 50 000 URLs per sitemap, JS rendering, people-first content, Search Analytics returns real performance | A mechanical lint, no score; search outcomes only via C7-A later |
| LinkedIn Posts API / versioning; Instagram content publishing | Dated versions with sunsets (202510 sunsets 2026-10-15); role-based organization posting; asynchronous publish; container expiry and publish quotas | Explicit, version-pinned declarations; current permission / role check; SUBMITTED ≠ published; no universal social API |
| RFC 6265; WHATWG "site"; MDN CSP sandbox / Sec-Fetch-Site / COOP | Cookies ignore ports; a site ignores ports; `sandbox` without allow-same-origin gives an opaque origin | Preview on 127.0.0.2 (another site), sandboxed, cookie-free (bind proven on the Founder host) |

None is authority; no vendor architecture imported.

## 5. Mechanism census (extend, never duplicate)

| Need | Existing canonical mechanism reused |
|---|---|
| Work, ownership, delegation, budgets, fencing, idempotency | C1 Work Items / queue / runs / fences; C2 tool idempotency keys, budgets, grants |
| File content | C1 Artifact Store (content-addressed, crash-safe, re-hashing reads) |
| Internal authoring actions | C2 Tool Registry + permission grants + Tool Executor (a closed, seeded catalogue) |
| External effects, approvals, reconciliation | C2 R3 tool path: approval fingerprint over the argument hash, `APPROVAL_DECIDE`, idempotent intent, `RECONCILIATION_REQUIRED`, `TOOL_RECONCILE` |
| Independent review | C4 Review Pool ACTION review of the exact act (maker excluded) |
| Credentials | `vault:` reference on the Tool record (no new store) |
| Founder decisions / attention | C5 governed confirmation; pending approvals already raise Needs-Me attention; reconciliation holds already surface |
| Scheduling | C1 queue time (`available_at`), the C5 Company Calendar projection |
| Training evidence / real outcomes | C7-C Pilot board (references only); C7-A governed evidence (untouched) |

Not found anywhere (therefore added): a digital project / revision / preview / candidate / target / promotion identity,
the internal catalogue, the preview host, the SEO lint and the external adapters.

## 6. Architecture (simple language)

Employees make digital work inside the Company with ordinary governed tools: they open a revision, write files (stored
in the Artifact Store), finalize it (it can never change again), open an internal preview (the Founder sees it without
anything being published), run an SEO check (findings, never a score) and package an exact Release Candidate. None of
this needs the Founder. Going outside the Company is different: the Employee prepares one exact external act and calls
the adapter's tool; the Review Pool reviews that exact act, the Founder approves exactly it, and only then does the
GitHub (or future hosting / social) driver act — once, idempotently, with reconciliation if the answer is lost.

## 7. Digital Project identity

`digital_projects`: id, type (WEBSITE, LANDING_PAGES, CONTENT_PROGRAM, LAUNCH_CONTENT, SOCIAL_PROGRAM), title (secret-
scanned), optional Goal, state DRAFT → ACTIVE → ARCHIVED (forward only, append-only history), creating Work Item,
creator. A project needs no external target. The C7-C Pilot is found through the Goal chain.

## 8. Internal Digital Workspace

The closed `digital-workspace` Tool (17 actions; R0 reads, R1 internal acts) through the Tool Executor; effect and tool
result in one fenced transaction. A working revision belongs to its Work Item. Files: single put (≤ 4 KiB, UTF-8 or
base64) or chunked upload (begin → exact 4 KiB chunks with hashes → commit verifying size and whole hash; no partial file
is ever mapped; chunks idempotent, a conflicting chunk refused). Reads return ≤ 1 KiB slices (the durable history keeps a
digest).

## 9. Revision / manifest model

WORKING → FINALIZED or ABANDONED; finalize re-hashes every object, enforces bounds, writes the deterministic manifest hash
(canonical, path-sorted entries); datastore triggers freeze finalized revisions and their files and re-check the file map.
A new revision may be based on a finalized one (its file map copied by reference).

## 10. Internal Preview security model

D-C7D-06. Proven over real HTTP (`preview-isolation`): sandboxed opaque-origin CSP without allow-same-origin;
`connect-src 'none'`, `form-action 'none'`, `worker-src 'none'`; noindex / no-store; COOP / CORP / COEP; no Set-Cookie; the
Founder session cookie sent by a browser changes nothing; traversal / encoded traversal / `.env` / `node_modules` /
drive / missing paths refused; source not served; foreign Host 403 (DNS rebinding); POST 405; service-worker request 403;
the Founder surface refuses cross-site and null-origin requests from the preview origin; a new revision is a new preview
while the old one keeps serving its exact bytes; a corrupt object refuses the asset and then the whole preview. Preview
is internal inspection only (`mode = INTERNAL` is the only datastore value).

## 11. Release Candidate lifecycle

A candidate binds one finalized revision + manifest hash (immutable). The lifecycle of each external act is derived
(D-C7D-07): PREPARED → UNDER_REVIEW → READY_FOR_FOUNDER → APPROVED → EXECUTING → PROMOTED, with REVIEW_REJECTED,
REJECTED, FAILED, RECONCILIATION_REQUIRED and STALE (a corrupt candidate or an expired / revoked approval).

## 12. Review / Founder approval binding

Every promotion action is R3: the existing C2 path requires a satisfied independent ACTION review of the exact act and
the Founder's approval of exactly its argument hash. The arguments always contain the candidate id and manifest hash, so
a changed candidate is a different act; export and merge are different actions; each post is its own promotion; a
rejected act never regenerates for the same candidate / target / kind; the APPROVAL_DECIDE preview names the promotion
kind, candidate summary, manifest hash, target and review state.

## 13. Promotion Target model

`digital_promotion_targets`: Founder-registered (authenticated chokepoint), typed class, adapter (the Tool driver code),
an allowlisted `<provider>:<identifier>` (no URL — datastore CHECK), the adapter's action map, ACTIVE / SUSPENDED /
RETIRED; identity immutable. Credentials stay `vault:` references on the adapter's Tool record.

## 14. Tool Executor integration

Internal acts: served by the executor itself for the reserved driver code (no external driver may claim it). External
acts: ordinary drivers handed to the runtime; they receive only the validated, frozen arguments and resolve their content
through the host-wired, read-only promotion source, which re-verifies the exact promotion. Idempotency key from durable
run state; UNKNOWN → reconciliation; replay recognized by the driver.

## 15. GitHub adapter and permissions

D-C7D-08. Permissions: `contents: write`, `pull_requests: write`, `checks: read`, `statuses: read`, `metadata: read`.
Actions: `repository-read` (R0), `pull-request-read` (R0), `promotion-reconcile` (R0), `candidate-export` (R3, UNSAFE),
`production-merge` (R3, UNSAFE). Proof there is no admin / bypass path: the frozen permission literal (verifier), a
broader granted token refused (proof + mutation), the closed endpoint allowlist refusing protection / admin / secrets /
collaborators / hooks / DELETE / PATCH even inside the HTTPS transport (proof + mutation + verifier), refs only created
(never updated or forced; verifier), merge only on `clean` with green checks and the `sha` guard (proofs + mutations).

## 16. Hosting / CMS adapter seam

`HostingPromotionDriver` + `HostingProviderPort` (preview, production publish, production rollback, current production —
distinct operations); declarations missing a distinct act are refused; rollback bound to the exact current version. No
provider implemented.

## 17. Content / SEO capability

Content artifacts (copy, articles, FAQ, metadata, structured data, launch copy, social packages, briefs, plans) are files
of a revision. `seoReadiness` (mind) — D-C7D-10 — 28 finding codes in three severities, deterministic, no score.

## 18. Social publication capability

A provider-neutral package (`social/post.json`: channel intent, text, media references to files of the same revision with
alt text, https links, an optional exact window, Goal refs, hypothesis); `SocialPublishDriver` + `SocialProviderPort` with
the fail-closed gate (D-C7D-09). No platform selected; no comment / reply / DM / spend.

## 19. Scheduling / Calendar integration

Publication windows on the existing Company Calendar (`PUBLICATION_WINDOW`); execution inside the window by an ordinary
Work Item; the driver refuses before / after it; a moved window is a different act (new approval); one live act per
candidate × target × kind; restart cannot double-post (stable key).

## 20. Privacy / secrets

No path from App data into the workshop (no action reads operational or external records; verifier forbids writes to
C6 / C7-A tables). Secret material refused in content, titles and summaries; audit / events carry ids, hashes and codes;
the durable tool history keeps digests for reads; drivers never see Company state beyond the resolved candidate; tokens
never in results (proof); provider errors become short codes.

## 21. C7-A / C7-C integration

The Pilot board API gains `digital` (finalized revisions, previews, candidates, promotions by state;
`publicationIsMarketSuccess: false`, `countsAsOutcome: false`). C7-D writes no evaluation, attribution, learning or
external evidence (proof + verifier); a later C7-A source can change a Pilot's market claim without touching C7-D rows
(immutable).

## 22. Schema / migration 0015

`0015_c7d_digital_presence.sql` (pinned in `RELEASED_MIGRATIONS`): ten tables (§26 of the brief, plus project history),
30 datastore gates (forward-only / immutable / no delete / exact bindings / closed catalogue), the seeded internal Tool.
STRICT, no content column, no hard delete. 0001–0014 untouched (0014 now frozen).

## 23. Proofs

| Suite | Marker | Tests |
|---|---|---|
| `governance/test/c7d-digital-kernel.test.ts` | `C7D-PROOF: digital-kernel` | 13 |
| `mind/test/c7d-seo.test.ts` | `C7D-PROOF: seo-readiness` | 6 |
| `storage/test/c7d-digital.test.ts` | `C7D-PROOF: storage-digital` | 7 |
| `tool-drivers/test/c7d-github.test.ts` | `C7D-PROOF: github-adapter` | 9 |
| `tool-drivers/test/c7d-seams.test.ts` | `C7D-PROOF: provider-seams` | 6 |
| `command-center/test/c7d-preview.test.ts` | `C7D-PROOF: preview-isolation` | 1 (HTTP end to end) |
| `runtime/test/c7d/c7d-runtime.test.ts` | `C7D-PROOF: runtime-c7d` | 3 (real runtime) |

45 tests covering the brief's 46 proof families (numbered in the test names): internal work with no Founder approval; the
export only after review + Founder approval of the exact act (reviewer ≠ maker); a separate merge approval bound to the
exported head; Founder rejection as history; an uncertain export held for reconciliation and never retried; datastore
gates attacked by direct SQL; secrets refused; chunked authoring; restart.

## 24. Mutations

`scripts/c7d-mutation-check.mjs`: 37 mutations (workshop code + datastore 10, exact binding 6, review / approval 2,
GitHub 8, Preview 5, SEO / social / hosting 6) — 37 / 37 caught locally. One first-run survivor (target identity) was a
proof passing for the wrong reason; the proof now varies only the identifier. CI: Windows 2 shards, Ubuntu 1, counted by
the quality gate.

## 25. Verifier

New rules: `c7d-requires-c7c-closure`, `c7d-not-claimed-closed` (also: the website claimed built or a vendor selected),
`c7d-proofs-present`, `c7d-digital-governed`, `c7d-tool-boundary`, `c7d-preview-isolated`, `c7d-no-vendor-preselection`;
the no-network rules admit exactly the Preview host and the GitHub transport; `tool-drivers` joins the allowed packages;
0014 frozen; C7-D mutation ids pinned. Self-test proves every rule can fail and admits the legitimate states. 93 / 93.

## 26. Focused validation (during implementation)

- C7-D suites: 13 + 6 + 7 + 9 + 6 + 1 + 3 = 45 / 45; mutations 37 / 37; verifier 93 / 93.
- Full suites of the touched packages: governance 107 / 107, mind 132 / 132, tool-drivers 15 / 15, command-center 11 / 11,
  command-center-ui 10 / 10, runtime 124 / 124; storage 498 / 502 on the first full run — the 4 were the expected
  applied-migration lists of the released-schema upgrade proofs (v6, v12, v13, v14 → now also 0015), updated and re-run
  green (they now prove those Companies upgrade through 0015).
- `typecheck` clean; ESLint `--max-warnings=0` clean on `packages` and `scripts`.

## 27. Final exact-head validation

The one final full local `npm ci` + `npm run ci` and the GitHub CI status run on the exact closure-candidate head; their
results are reported in the PR handoff, not here (writing them here would change the head they describe).

## 28. Residuals / deferred

Acceptable by the brief (§40, future Company decisions / operating actions, not defects): framework, hosting, CMS,
analytics, Search Console connection, social platforms and credentials, paid-ad platform, the actual website content /
design / code / repository, domain / DNS, production deployment.

- **R-C7D-01** No Windows protected-vault implementation exists in the repository; the GitHub driver takes a
  `GitHubCredentialSource` resolving its `vault:` reference at the protected boundary. Wiring the real vault is an L1 /
  connection-time operating step.
- **R-C7D-02** The GitHub HTTPS transport is exercised only through its allowlist in CI (no live call, no real
  credential); the first live connection is a Founder-approved operating action.
- **R-C7D-03** No hosting, CMS, social or search-property adapter is implemented (by design).
- **R-C7D-04** A scheduled post runs as an ordinary Work Item inside its window; no automatic "create the Work Item at
  `notBefore`" convenience.
- **R-C7D-05** The Preview serves static files only; a build-needing revision is a surfaced capability gap. Browser
  enforcement of the sandbox is proven at the header level plus the specifications; no separate headless-browser proof.
- **R-C7D-06** Reconciliation stays the Founder's existing `TOOL_RECONCILE` decision; `promotion-reconcile` supplies
  the evidence.
- **R-C7D-07** An export replay after someone else pushed to the candidate branch fails closed (`BRANCH_CONFLICT`)
  instead of recognizing the earlier PR.
- **R-C7D-08** No Founder UI form registers targets (Founder store API, like Tool registration).
- **R-C7D-09** The preview listener re-derives the revision's manifest per request (correctness over speed; fine for
  internal previews).
- **R-C7D-10** Marketing Operations organizational placement / staffing stays a Founder / Company decision (no sixth
  Department).
- **R-C7D-11** GitHub REST `2026-03-10` is to be evaluated before the pinned version's 2028 sunset.

## 29. Local / L1 handoff

Connect a real provider only after a Company recommendation and Founder decision: create the private GitHub App with the
five permissions on the chosen repository, store its key in the host vault, register the Tool with
`GITHUB_TOOL_REGISTRATION` and `credentialRef: vault:<name>`, register the target, wire `GitHubCodeHostDriver` with
`runtime.promotionSource()` and the repository allowlist, grant the Employees who may export / merge (R3), declare an
ACTIONS Review Plan on their Work Items. Confirm 127.0.0.2 binding on the Founder host (proven on this host).

## 30. Future first website Pilot handoff

The Founder briefs the CEO (C7-C), activates a Pilot on a broad Goal ("Prepare QANDEEL for launch in Egypt"). The Company
researches and asks questions, proposes strategy, structure and a technical recommendation (framework, hosting, CMS,
analytics, channels — to be decided then), creates a Digital Project on the Goal, iterates revisions and previews
internally without approvals, reviews and reworks, packages a candidate, prepares the export and asks the Founder only
for the external act. Real results later arrive through governed C7-A evidence; the Pilot board shows the digital
evidence beside them.

C7-D is NOT CLOSED.

## 31. Lifecycle note (appended at the L1-01 start, 2026-10-05)

The narrative above is history and is not rewritten. The first closure candidate `427f759` drew no product finding: its
run #102 was cancelled when the Windows `c6-1of2` mutation shard hit the 45-minute job ceiling while every mutation was
passing (a validation-capacity defect). The permanent correction `2e30a54` rebalanced the Windows C6 mutations from 2 to
4 shards without removing coverage or raising the ceiling. After the Technical Lead's exact-head review of `2e30a54`,
PR #16 merged into `main` as `3d835ecc261168790c674409a355e36b7b30004f` (same tree `8a34a7ec`); exact-head run #103
passed the full Windows + Ubuntu gate on its first attempt (47 jobs, zero failures) and post-merge run #104 passed the
fast-integrity path. The canonical closure statement is `docs/C7D_CLOSURE_RECORD.md`: C7-D is CLOSED / MERGED /
CANONICAL, and with it C7 as a whole.
