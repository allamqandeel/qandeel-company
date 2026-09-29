# C5 — Founder Command Center — Attention Orbits / Living Company Universe — Implementation Report

**Status:** IMPLEMENTATION CANDIDATE / NOT CLOSED. C5 closes only after Technical Lead exact-head
review, green CI, merge, post-merge proof and closure sync. This document is the pre-code design
gate (sections 1–12) followed by the implementation record.

## 1. Start gate (re-proved from repository truth, 2026-09-29)

| Check | Result |
|---|---|
| Repository | `allamqandeel/qandeel-company` (confirmed through `gh api`) |
| Remote truth | `origin/main` = `ff7f71cc8ed4378469ed23df6f3dadefaba631a8` — equals the expected canonical base. Fetched with GitHub Desktop's signed Git (system Git's HTTPS helper is blocked by Smart App Control on the Founder host, as recorded in `docs/environment/L0_READINESS_DECISION.md`). |
| PR #8 | C4 implementation, merged 2026-09-28T21:53:37Z as `595083a3a98b4823698ea15eaf3d8efa12965e23` |
| PR #9 | C4 closure / canonical sync, merged 2026-09-28T21:59:27Z as `ff7f71cc8ed4378469ed23df6f3dadefaba631a8` |
| Commits on `main` after the expected SHA | none |
| `docs/C4_CLOSURE_RECORD.md` | "CLOSED / MERGED / CANONICAL" |
| `docs/architecture/IMPLEMENTATION_MAP.md` | `C5 … Not started` |
| Working tree | clean before branching |
| Engines | Node `v24.19.0`, npm `11.17.0` satisfy `>=24.12.0 <25` / `>=11.6.0 <12` |
| Released migrations | `0001`–`0008` present; their SHA-256 pins are unchanged (re-verified by the storage migration test and `npm run verify` in the focused gate) |
| Branch | `c5/founder-command-center-attention-orbits` created from exact `ff7f71cc` |

Founder host constraints kept: Windows 11, Node 24 LTS, npm 11, Smart App Control ON, PowerShell,
signed GitHub Desktop Git, no `tar.exe`, local-first, no Cloud-VM dependency after the task.

## 2. G1 — Skills census

Installed Skills were enumerated from the user skill directory, the plugin cache and the bundled
set. Used means the Skill's guidance changed a concrete decision in this candidate.

| Skill (as installed) | Used | Exact purpose in C5 |
|---|---|---|
| `impeccable` (SKILL.md + audit / critique / craft-floor; its `scripts/context.mjs` is absent on this host) | Yes | Operate-mode framing of the Founder surface; craft-floor checks (contrast, one authored motion moment, themed browser surfaces, no eyebrow labels, no card scaffolds) applied to the focus panel, command palette and attention rail; critique pass before the visual proof |
| `ui-ux-pro-max` (2.13.0; `search.py` needs Python, which the host lacks — data files read directly) | Yes | `stacks/threejs.csv` (pin exact release, addon imports from the same release, dispose geometries/materials, `setPixelRatio` cap, resize handling), `ux-guidelines.csv` priorities 1–2 (contrast 4.5:1, keyboard navigation, 44px targets, no hover-only affordance), `motion.csv` (context-aware timing, reduced-motion) |
| `frontend-design` (plugin) | Yes | Visual identity plan for the universe (palette / type / layout / principles) reviewed against the generic-default tells before coding; copy written from the Founder's perspective |
| `dataviz` (bundled) | Yes | Status encoding by shape + text, never colour alone; categorical Department hues assigned in fixed order; sequential haze for time depth; legend always present for ≥2 encodings |
| `animate` | Yes | Motion gate: which interactions must not animate (keyboard-initiated palette open, list navigation), easing tokens (`cubic-bezier(0.23,1,0.32,1)` out, `cubic-bezier(0.77,0,0.175,1)` in-out), durations ≤300 ms for UI, camera moves 400–600 ms, transitions over keyframes for interruptible focus changes, `prefers-reduced-motion` parity mode |
| `emil-design-eng` | Yes | Press feedback (`scale(0.97)`), origin-aware popovers, `transform`/`opacity`-only UI animation, CSS/WAAPI over JS under load |
| `sibawayh:designing-arabic-frontends` | Yes | `<html lang="ar" dir="rtl">`, Arabic font stack with line-height ≥1.6, logical CSS properties, LTR islands for IDs / SHAs, one numeral policy (`ar-EG` locale through one shared formatter), no letter-spacing on Arabic, icons mirrored by meaning, labels never rendered as WebGL text |
| `sibawayh:writing-eloquent-arabic` | Yes | All Founder-facing Arabic copy (lens names, attention rail, action preview, errors) written in Arabic structure; register: فصحى for governed confirmations, warm for navigation |
| `artifact-diagramming` (bundled) | Yes | Architecture / trust-boundary figures in this report |
| `github-actions` | Yes | CI extension: parallel `c5-ui` job, docs fast path preserved, no `continue-on-error` |
| `review-animations`, `improve-animations`, `find-animation-opportunities` | Partly | `review-animations` checklist applied as the self-review of the motion layer; the other two are audit tools for existing code and were not needed |
| `animation-vocabulary` | No | Marketing-motion vocabulary; not an Operate surface concern |
| `typegpu` | No | WebGPU-only; C5 keeps WebGL2 as the stable primary renderer (section 6) |
| `prototype`, `detour`, `synced`, `moq-kit`, `fishjam`, `pulsar-haptics`, `radon-mcp`, `rnrepo`, all React Native / Expo Skills | No | Native-mobile or unrelated product areas |
| `docs`, `docx`, `pptx`, `xlsx`, `pdf`, `morning`, `import-memory`, `setup-writing-style`, `skill-creator` | No | Document formats / assistant features unrelated to C5 |

Relevant Skill families that are **not installed**: a dedicated security-review Skill, a dedicated
testing / code-review Skill, and a dedicated accessibility-audit Skill. Their concerns were covered
by the Stage 14 threat-boundary section, the adversarial test set and the accessibility section of
this report instead.

## 3. Research refresh (bounded, 2026-09-29, primary sources)

| Topic | Finding | Consequence for C5 |
|---|---|---|
| TypeScript frontend build tooling | Vite 8.3 depends on `rolldown` and `lightningcss` (native binaries); Vite 5–7 depend on `esbuild` (native binary) and Rollup 4 (native `@rollup/rollup-win32-x64-msvc`). Those binaries are not Authenticode-signed and are blocked by Smart App Control on the Founder host (the same failure family L0 recorded for `tar.exe` and system Git). | **No bundler.** The UI is compiled by the repository's existing `typescript` (pure JS) to native ES2022 modules and served with an import map by the loopback server. |
| 3D renderer | `three@0.186.1`: MIT, zero dependencies, no install scripts, pure JavaScript ESM (`build/three.module.js`, addons under `examples/jsm`). `WebGPURenderer` exists with automatic WebGL 2 fallback, but its API is still moving between releases. | `three` is the single runtime dependency of the UI package, served locally from `node_modules`. Primary renderer: `WebGLRenderer` (WebGL 2, stable for years). WebGPU is not adopted in C5. |
| WebGL / WebGPU support and fallback | Edge 154 on the Founder host renders WebGL 2 even headless (SwiftShader). Any WebGL-unavailable case must still show the company. | Graceful fallback: the same universe rendered as SVG 2.5D by the same layout module (section 6). |
| Arabic / RTL in 3D UI | Signed-distance-field text libraries (`troika-three-text`) ship their own shaper (Typr) without HarfBuzz; Arabic shaping and bidi remain partial. Browsers shape Arabic correctly in HTML/SVG. | Every label, name, number and message is HTML or SVG text positioned from the projected 3D coordinates; WebGL draws only geometry, light and atmosphere. |
| Graph / spatial layout | A force layout would violate the stable-spatial-memory contract (random on reload). | Deterministic polar layout: radius from seat kind, angle from Department sector plus a stable hash of the seat / employee ID inside the sector; pure function, unit-tested. |
| Accessibility and reduced motion | WCAG 2.2 keyboard / focus / 2.3.3 (animation from interactions) and `prefers-reduced-motion`. | Entities are real focusable DOM elements (roving tabindex) with accessible names / status; reduced motion is a parity mode (cuts / crossfades, no continuous drift) with every state still visible. |
| Local-only browser UI security | Current advisories (2025–2026) on loopback servers: DNS rebinding through missing `Host` validation, CSRF against `localhost`, and unauthenticated local APIs. | Loopback bind only; `Host` and `Origin` allow-lists; HttpOnly `SameSite=Strict` session cookie whose value is stored only as a hash; per-session CSRF secret in a custom header for every state change; single-use launch tokens; fail-closed session checks (section 7). |
| Testing a 3D UI without fragile CI | Pixel snapshots of WebGL are brittle; the Chrome DevTools Protocol is reachable with Node 24's built-in `WebSocket` and `fetch`, and Chrome / Edge exist on GitHub runners and on the Founder host. | Deterministic tests for layout / projection / intents / attention in `node:test`; one headless-browser smoke (boot, WebGL or fallback, selection, focus / return, reduced motion) through CDP with zero dependencies; it fails when no browser is found in CI and reports SKIPPED locally. |
| Licensing and maintenance | `three` MIT (monthly releases, 15+ years); `@types/three` MIT (DefinitelyTyped, dev-only, pulls small typing-only dependencies). | Two additions total: one runtime (`three`), one dev (`@types/three`). No CDN, no remote asset, no native addon, no desktop shell. |

## 4. Current-state dependency census (what C5 consumes, what it must not touch)

| Existing mechanism | C5 use | Constraint kept |
|---|---|---|
| `principals` (`kind = FOUNDER`), `founderAdminWrite` chokepoint in `packages/storage/src/governance.ts` | The production Founder surface arms this chokepoint per verified session (section 7); every C2/C3/C4 Founder act keeps its existing signature | A Founder ref is never authentication (D-C2-13); the test seam stays test-only |
| `approvals` + `GovernanceStore.decideApproval` | "Needs Me" items and the confirmed `APPROVE` / `REJECT` actions | R4 stays Founder-only and never approvable; R3 needs review and approval; self-approval refused |
| `org_positions`, `position_assignments` (effective-dated), `run_org_snapshots`, `employees`, `departments` | Rank → radius, Department → sector, seat holders, vacancies, ACTING coverage, time-correct Historical Focus | Read only; organization truth changes only through the C4 acts |
| `work_items`, `queue_jobs`, `runs`, `work_delegations`, `handoff_messages`, `review_requests`, `review_assignments`, `review_conflicts`, `quality_holds` | Live work, typed live relations (WORK / DELEGATION / SUPPORT / REVIEW / APPROVAL / HANDOFF / ESCALATION), blocked / waiting signals | Read only; edges are drawn only from live rows |
| `c2.employee-task` governed loop, `ModelProposal`, `runtime-authority` fenced writes | Employee / CEO replies and CEO briefs are produced by governed runs proposing a new `MESSAGE` proposal type, recorded through a fenced write | No ungoverned model call; model output cannot name authority |
| `queue_jobs` wake triggers, `WakeSignal`, `CompanyRuntime.onEvent` | A Founder message that needs a reply creates a Work Item (the queue trigger advances the wake generation); the UI is pushed a content-free "changed" signal over Server-Sent Events from the same process | No polling loop; no outbox dispatcher added; the `events.aggregate_type` CHECK is untouched (C5 emits audit rows, not new outbox event types) |
| `OrganizationStore.calendar(from, to)`, `position_assignments.planned_to`, `work_items.due_at`, `approvals.expires_at`, `staffing_requests.decision_due_at`, `review_plans.deadline_at`, Goal horizons (new) | Calendar foundation as a projection | No calendar table |
| `RELEASED_MIGRATIONS` 0001–0008 (pinned, frozen) | Migration `0009_c5_founder_surface.sql` appended | Released migrations untouched |
| `scripts/verify-bootstrap.mjs` | Later-scope regexes narrowed to C6 / C7; `command-center*` packages allow-listed; `three` allow-listed for the UI package only; new C5 rules | Every prior rule keeps passing |
| CI (`.github/workflows/ci.yml`) | UI build / typecheck / lint / tests run inside the existing `static` and `tests` jobs; `c5:acceptance` joins the `acceptance` job; `c5:mutation` shards join the `mutation` matrix on both OSes | No job removed; no `continue-on-error`; the parity gate is extended |

Consumers of the changed modules were enumerated before editing: `governance.ts` (Founder chokepoint) is used by the C2 / C3 / C4 stores and their tests; `proposals.ts` by the model runtime and the employee loop; `runtime.ts` services by `employee-task.ts`; the verifier by CI on every path.

## 5. C5 architecture map

```
Founder (human, Windows user session)
   │  browser (Edge / Chrome), http://127.0.0.1:<port>/  — loopback only
   ▼
packages/command-center-ui        (browser; tsc → native ESM; three.js WebGL2 + HTML labels; SVG fallback)
   │  JSON over same-origin fetch + one SSE stream; cookie session + CSRF header
   ▼
packages/command-center           (Node; the Founder local application surface)
   ├── server/   loopback HTTP listener, Host/Origin allow-list, session cookie, CSRF, static files, SSE
   ├── api/      explicit capabilities only (no "execute anything"): universe, focus, attention, goals,
   │             threads, command (read intents), previews (mutating intents), confirm, timeline, calendar
   ├── auth/     launch tokens, sessions (hashes only), fail-closed verification
   └── cli.ts    `qandeel-founder serve --workspace <dir>` (runtime + surface in one process), `open`
   ▼
packages/runtime (CompanyRuntime) ── `founder` admin handle (goals, communications, attention, actions,
   │                                  sessions, universe projection) — every call signals the dispatcher
   ▼
packages/storage                  ── founder-auth.ts (session scope), goals.ts, communications.ts,
   │                                 attention.ts, founder-actions.ts, universe.ts (read model), 0009 migration
   ▼
SQLite/WAL (canonical truth)      ── C1–C4 tables unchanged + C5 tables
```

The UI never opens SQLite, never holds a `CompanyStore`, never imports `runtime-authority` or the test seam. The surface package holds the `CompanyRuntime` it started and reaches storage only through the runtime's admin handles and the exported stores, exactly like the engineering CLI.

## 6. UI technology decision (technology selection gate)

1. **Framework / build stack:** none. TypeScript (already in the repository) compiles `packages/command-center-ui/src` to ES2022 modules; the page loads them natively through an import map. No React, no Vite, no bundler.
2. **3D renderer:** `three@0.186.1` `WebGLRenderer` (WebGL 2), served from `node_modules` by the loopback server.
3. **Stable enough for Strong v1:** `three` core has shipped monthly for 15 years under MIT with zero dependencies; WebGL 2 is universally available on the Founder host's browsers (verified headless on Edge 154). The moving parts (WebGPU, TSL) are not used.
4. **Dependency count:** one runtime dependency (`three`) in the UI package and one dev dependency (`@types/three`). A hand-written WebGL engine would be more code than the rest of C5 and could not be reviewed in one candidate; a Canvas 2D engine cannot deliver the volumetric atmosphere the Founder asked for.
5. **Fallback:** the same layout module renders the universe as SVG 2.5D when WebGL 2 is unavailable (or on `?renderer=svg`), with the same labels, selection, focus lenses, attention rail and actions. It is not an Org Chart.
6. **Arabic / RTL label strategy:** every string is HTML / SVG text (browser shaping and bidi), positioned from projected 3D coordinates; `<html lang="ar" dir="rtl">`; IBM Plex Sans Arabic bundled locally (OFL) with a Windows fallback stack; one numeral policy (`ar-EG`) through one formatter; LTR islands for IDs.
7. **Windows + Smart App Control:** no native binary anywhere in the build or runtime path; the signed Node runtime serves signed browsers; assets are repository files.
8. **Rejected alternatives:** Vite / esbuild / Rollup / Rolldown (native binaries blocked by Smart App Control); WebGPU-only (`typegpu`) (no stable fallback story, moving API); `troika-three-text` (partial Arabic shaping); Electron / Tauri (a shell adds signing and update surface without a C5 requirement); a force-directed graph library (violates stable spatial memory; a second graph model).

### Technical spike (before the large build)

The spike is the first cut of the real UI package, not a separate project. It must prove: the scene boots locally from the loopback server; Arabic and English labels are crisp; Founder centre plus three orbit levels render; pointer selection works; camera focus / return works; reduced motion removes continuous motion without losing meaning; no external network asset is loaded (checked by a verifier rule against `http(s)://` in UI sources and by the CSP `default-src 'self'`). Result recorded in section 14.

## 7. Auth boundary (Stage 14 read in full; local threat boundary)

**Threat model.** The adversary is (a) any web page open in any browser on the same machine (DNS rebinding, CSRF, cross-site SSE), (b) any local process that can reach loopback but is not acting for the Founder's Windows user, (c) forged or replayed UI payloads, (d) natural-language text that tries to self-authorize, (e) a stale or stolen session cookie. Out of scope for C5: a compromised Windows user account (that account already owns the SQLite file) and remote access (the surface never leaves loopback).

**Controls.**
- The listener binds `127.0.0.1` only; `Host` must be `127.0.0.1:<port>` or `localhost:<port>`; every state-changing request must carry `Origin` equal to the server's own origin and the `X-QANDEEL-Founder-CSRF` header equal to the session's CSRF secret; `Sec-Fetch-Site`, when present, must be `same-origin` or `none`. SSE and JSON reads require the session cookie too (nothing is readable anonymously except the launch page).
- **Launch token:** `qandeel-founder open` (run by the Windows user against the workspace) mints a 32-byte random token, stores only its SHA-256 in `founder_launch_tokens` with a 90-second expiry, and opens `http://127.0.0.1:<port>/launch#<token>` (fragment: never sent to the server as a URL, never logged). The page posts the token once; the server hashes, matches, marks it consumed and issues a session.
- **Session:** 32-byte random cookie value, `HttpOnly; SameSite=Strict; Path=/`, stored only as SHA-256 in `founder_sessions` with created / expires (8 hours) / last-seen / revoked columns and a per-session CSRF secret (also stored hashed; the plaintext is returned once to the page). Every request re-verifies the hash, expiry and revocation inside storage; on server stop all sessions are revoked. Expired / invalid / revoked → `FOUNDER_SESSION_INVALID` (HTTP 401), fail closed.
- **Authority binding:** a verified session yields a `FounderSession` value that `founderSessionScope(store, session, fn)` uses to arm the Founder chokepoint synchronously for the duration of `fn` (storage calls are synchronous; nothing else can interleave). Outside that scope every Founder write still fails with `FOUNDER_SURFACE_UNAVAILABLE`. The test seam is untouched and unreachable in production.
- **Privileged confirmation:** a mutating intent becomes a `founder_action_previews` row (structured, expiring after 10 minutes, bound to the session). Confirmation requires the session, the CSRF header, the preview id and the exact preview fingerprint; only then does the server call the real boundary (`decideApproval`, Goal approval, …) inside the session scope, and the preview is marked `CONFIRMED` with the resulting record id. Natural-language text never mutates anything by itself.
- **Secrets:** no secret is persisted in plaintext (token and cookie values exist only in memory and in the browser); rows hold hashes. Windows user-scoped protection (DPAPI, proven in L0) is therefore not needed in C5; the seam for a persisted device key is recorded in section 11.
- **Audit (content-free):** `founder.session_issued`, `founder.session_revoked`, `founder.launch_refused`, `founder.request_refused` (reason codes only), `founder.action_previewed`, `founder.action_confirmed`. Logs carry IDs, codes and counts only (Rule A).
- **Headers:** CSP `default-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'`, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on API responses.

## 8. Goal / communication / attention data model (migration 0009)

| Table | Purpose | Key columns / invariants |
|---|---|---|
| `goals` | Durable Goal identity (Stage 2 Direction) | `kind` COMPANY / DEPARTMENT; `department_id` iff DEPARTMENT; `title`, `summary`, `success_criteria_json`; `state` DRAFT → PROPOSED → APPROVED → ACTIVE → (PAUSED) → ACHIEVED / CANCELLED / SUPERSEDED; `owner_ref`; `parent_goal_id` (a DEPARTMENT goal derives from a COMPANY goal); `horizon_from`, `horizon_to`; `approved_by_ref` (`founder:*`, required for a COMPANY goal to be APPROVED / ACTIVE — CHECK); `version`; no delete; superseding keeps history |
| `goal_history` | Append-only lifecycle | `(goal_id, version)` unique, `from_state`, `to_state`, `reason_code`, `actor_ref` |
| `goal_work_links` | Goal → Work traceability | `(goal_id, work_item_id)` unique; `link_kind` SERVES / DERIVED; `created_by_ref`; no delete (a link is ended with `ended_at`) |
| `communication_threads` | Founder-facing threads | `kind` FOUNDER_CEO / FOUNDER_EMPLOYEE / CEO_BRIEF; `employee_id`; `context_kind` / `context_ref` (GOAL, WORK_ITEM, DECISION, REVIEW, APPROVAL, DEPARTMENT, INCIDENT); `access_scope` = FOUNDER_ONLY; `state` OPEN / CLOSED |
| `communication_messages` | Durable messages (company content under a Stage 9 access scope — not telemetry) | `thread_id`, `seq`, `sender_kind` FOUNDER / EMPLOYEE, `sender_ref`, `purpose` (Stage 9 set + BRIEF), `attention_level` INFORMATIONAL / NEEDS_ATTENTION / NEEDS_DECISION / URGENT, `body` ≤ 4000, `body_sha256`, `brief_json` (what / why / recommend / decision) required when `purpose = BRIEF`, `response_required`, `reply_work_item_id` (the governed run that answers a Founder message), `run_id` for Employee messages, `superseded_by`; append-only |
| `founder_attention_items` | Durable attention state (dedup, cooldown, resolution) | `dedup_key` unique (`approval:<id>`, `brief:<message id>`, `escalation:<delegation id>`, `conflict:<id>`, `thread:<id>`); `lane` NEEDS_ME / CEO_BRIEFS / THREADS; `level`; `source_kind`, `source_ref`; `state` OPEN / RESOLVED / DISMISSED; `first_seen_at`, `last_signal_at`, `signal_count`, `cooldown_until`, `resolved_at`, `resolved_reason` |
| `founder_launch_tokens` | Single-use browser bootstrap | `token_sha256` unique, `expires_at`, `consumed_at`; hashes only |
| `founder_sessions` | Authenticated Founder sessions | `token_sha256` unique, `csrf_sha256`, `created_at`, `expires_at`, `last_seen_at`, `revoked_at`, `revoke_reason` |
| `founder_action_previews` | Governed confirmation boundary | `session_id`, `intent_kind` (closed set), `payload_json`, `fingerprint`, `state` PREVIEW / CONFIRMED / REJECTED / EXPIRED, `expires_at`, `result_ref` |

Nothing above stores a secret (hash columns are named `*_sha256`); no table reuses `handoff_messages`; Message ≠ Decision ≠ Knowledge; Goal ≠ Work Item.

## 9. Read-model projection (`packages/storage/src/universe.ts`)

`projectUniverse(store, { at? })` → `CompanyUniverse`:
- `founder` (principal ref or `unregistered`), `departments` (canonical order → sector index), `seats` (kind, department, reports-to, status, holder at `at`: PRIMARY / ACTING / vacant, `coversEmployeeId`), `employees` (name, state, seat, department, chain to Founder), `work` (live items with state, owner, department, goal links, blocked / waiting reason), `relations` (typed live edges: DELEGATION, SUPPORT, REVIEW, APPROVAL, HANDOFF, ESCALATION; each with `from`, `to`, `since`, `sourceRef`), `goals` (with anchor Departments), `attention` (open items), `signals` (counts: blocked, waiting review, waiting approval, running), `at`, `live`.
- Deterministic: every array is sorted by stable IDs; the same store state yields byte-identical JSON.
- Time-correct: with `at`, seats come from `position_assignments` effective ranges, work / delegation / review states from their history tables, goal states from `goal_history`.
- Permission-aware: the Founder sees company content (names, titles, message bodies) but never App data (none exists in this repository) and never secrets (none stored). The projection is not canonical truth and is never written back.

The UI layout module (`packages/command-center-ui/src/model/layout.ts`, pure) turns the projection into positions: `radius(kind)` — FOUNDER 0, CEO 1, DIRECTOR 2, MANAGER / LEAD 3, SPECIALIST 4; `sector(department)` — five equal angular sectors in canonical order plus a narrow company sector for company-scoped seats; the angle inside a sector comes from a stable hash of the seat code (seats, not people, own the angle: a transfer moves the person to the new seat's angle and a vacancy keeps its place); goals sit outside ring 4 at the mean angle of their Departments; attention items settle in the zone between the centre and ring 1.

## 10. C1–C4 backward integration matrix

| Contract | How C5 preserves it | Proof |
|---|---|---|
| C1 durable Work Items / runs, leases and fencing | Replies are Work Items processed by the governed loop; C5 fenced writes present the job fence; the surface never claims work | storage `c5-founder-surface.test.ts`, runtime `c5/c5-runtime.test.ts` |
| C1 event-driven waiting, no polling | Reply work is enqueued through `queue_jobs` (wake triggers); the UI stream is pushed from the process that wrote | runtime test; verifier `no-network-in-runtime-code` still scans everything outside the surface listener |
| C1 recovery / backups | New tables are STRICT, append-only history, no delete; `backup_records` unchanged | migrations test; acceptance restart step |
| C2 Employee ≠ Model ≠ Session; R0–R4; Founder approval semantics | `decideApproval` unchanged; Founder authority only inside a verified session scope | storage `c5-founder-surface.test.ts` (a ref is not auth; an expired session fails closed), command-center `surface.test.ts` |
| C2 budgets / tool governance / provider neutrality | Untouched; replies spend from the Employee's budget like any task | runtime test |
| C3 Memory ≠ Truth; context assembly; no ungoverned model call | The reply run's context is assembled by C3; the Founder message reaches the model only as the Work Item's instructions | runtime test |
| C4 CEO company scope, five Departments, Position / Assignment truth, time-correct attribution, delegation, Review Pool, R3 review + approval, R4 Founder-only, P-07 | Read-only projection; the Review Pool is not a sector; R4 approvals are never offered as confirmable actions | storage `c5-founder-surface.test.ts` (projection, attention), UI `layout.test.ts` |
| Rule A | New audit / log calls carry IDs, codes, counts; verifier rule `c5-telemetry-content-free` scans the C5 modules for `body`, `title`, `summary`, `text`, `brief` in telemetry calls | verifier self-test + tests |

## 11. C6 / C7 forward seams (nothing implemented here)

- Stable IDs and lineage: `goals.id`, `goal_work_links`, `communication_threads.id`, `founder_attention_items.dedup_key` and `run_id` references let C6 compute outcome / attribution analytics without new identity.
- The projection carries `signals` counts but no scores; C6 adds analytics behind a separate read model, not by widening `CompanyUniverse`.
- `communication_threads.context_kind` is an open code set so C7 can add `CHANNEL` / `EXTERNAL` sources without changing meaning; no "the App is the only channel" assumption exists.
- Auth seam: `founder_sessions` may later bind a DPAPI-protected device key (column reserved by name here, not created).

## 12. Primary risk list

| Risk | Mitigation in this candidate |
|---|---|
| Smart App Control blocks a transitive native binary | Only `three` (pure JS) and `@types/three` (types) are added; `npm ci` on the Founder host is part of the focused gate |
| Session scope arming misused | The scope function is storage-internal, synchronous, and a verifier rule allows its internals only in `founder-auth.ts`; adversarial tests present refs, expired sessions and forged CSRF |
| Spaghetti at scale | Edges only from live rows, per-lens culling, label LOD; a synthetic 60-employee organization in the layout tests and the scale proof frame |
| Ambient motion mistaken for company events | The ambient layer has no colour meaning, no direction and no relation to any entity; semantic motion always starts and ends at an entity and is listed in the activity strip |
| CI fragility of a browser smoke | Deterministic tests cover the logic; the browser smoke runs through CDP with a bounded budget and fails only on genuine boot / selection / fallback failures |
| Stage 16 absence | Product direction is taken from the C5 brief; open questions are listed in section 16 rather than decided |

---

# Implementation record

## 13. What C5 builds (files, sizes, decisions realized)

| Area | Files | Notes |
|---|---|---|
| Storage (C5 modules, ~1 780 lines) | `packages/storage/src/founder-auth.ts`, `goals.ts`, `communications.ts`, `attention.ts`, `founder-actions.ts`, `universe.ts`, `universe-attention.ts`, `founder-records.ts`; `governance.ts` (+ `founderSessionInternals.scope`), `runtime-authority.ts` (+ `recordMessage`, `recordGoalAct`), `index.ts` | One migration `0009_c5_founder_surface.sql`, pinned in `RELEASED_MIGRATIONS` as `803f9eef58fad2afaabbca562c509648aaf59cc21ad647728957fa31d6ab00b1`; `0001`–`0008` untouched |
| Governance kernel | `packages/governance/src/founder.ts` (goal lifecycle, message vocabulary, attention rules, `classifyFounderIntent`), `proposals.ts` (+ `MESSAGE`, `GOAL_ACTION`) | Pure, deterministic; no I/O |
| Runtime | `packages/runtime/src/runtime.ts` (`founder` admin handle: `auth`, `goals`, `communications`, `attention`, `actions`, `universe`, `onFounderChange`), `c2/types.ts`, `c2/employee-task.ts` (MESSAGE / GOAL_ACTION proposals executed through fenced writes), `c2/deterministic-fakes.ts` (`defaultScript`, `{ hold, then }` entries) | The dispatcher is signalled by every Founder write; no polling |
| Founder surface (~1 000 lines) | `packages/command-center/src/security.ts`, `static.ts`, `api.ts`, `server/listener.ts`, `briefing.ts`, `surface.ts`, `cli.ts` | The only network listener in the product; loopback only |
| Browser UI (~2 300 lines TS + CSS + HTML) | `packages/command-center-ui/src/model/{types,layout,lenses,format}.ts` (pure), `src/app/{main,scene,labels,svg-renderer,panels,api,renderer,launch}.ts`, `public/{index.html,launch.html,styles.css,fonts/…}` | three.js WebGL 2 scene + HTML label layer; SVG 2.5D fallback; IBM Plex Sans Arabic bundled (OFL) |
| Dependencies | `three@0.186.1` (runtime, UI package only), `@types/three@0.186.0` (dev) | Pure JavaScript; no install scripts; allow-listed in the verifier |
| Verifier / CI | `scripts/verify-bootstrap.mjs` (5 new rules, later-scope regexes narrowed, `three` allow-list, synthetic-repo fixtures), `.github/workflows/ci.yml` (mutation shards `c5-1of1` on Windows and `c4-c5` on Ubuntu; `c5:acceptance` + `c5:spike` in `acceptance`), `scripts/ci/quality-gate.mjs` (parity covers `c5`) | Nothing removed; no `continue-on-error` |
| Proof scripts | `scripts/c5-acceptance.mjs`, `scripts/c5-mutation-check.mjs` (16 mutations), `scripts/c5-visual-proof.mjs` + `scripts/c5/{seed-company,cdp,encoder}` | Browser driven through the DevTools Protocol with Node's built-in `WebSocket` / `fetch`; MP4 encoded in-browser with WebCodecs |
| Tests | `packages/governance/test/c5-kernel.test.ts`, `packages/storage/test/c5-founder-surface.test.ts`, `packages/runtime/test/c5/c5-runtime.test.ts`, `packages/command-center/test/{security,briefing,surface}.test.ts`, `packages/command-center-ui/test/layout.test.ts` | `C5-PROOF` markers required by the verifier |

**Design-gate deltas** (where the implementation names things differently from sections 5–9; recorded rather than silently rewritten):

- The launcher commands are `qandeel-founder serve` and `qandeel-founder launch` (section 5 / 7 said `open`); neither offers a Founder write command.
- The session scope is entered through `FounderAuthStore.withSession(session, fn)`; `founderSessionInternals.scope` lives in `governance.ts` and is importable by `founder-auth.ts` only (section 7 called it `founderSessionScope`).
- Ring indices in section 9 map to scene radii `CEO 2.6`, `DIRECTOR 5.4`, `MANAGER / LEAD 8.2`, `SPECIALIST 11`, `GOAL 14.2`, attention `1.35` (D-C5-09); depth is a second rank cue.
- The CSP carries a per-response nonce for the import map (`script-src 'self' 'nonce-…'`) in addition to the section 7 directives; `Cross-Origin-Opener-Policy: same-origin` is also set.
- Refusals of a session or launch token are audited in their own transaction *after* the refusing transaction rolled back (an audit row written before the throw would have rolled back with it); the error carries codes only.
- Attention markers keep their shape and glow on the map at every zoom, but their captions appear only in the Attention lens, when near, or when selected: the rail carries the words, so the CEO orbit never becomes a stack of captions.
- The seven release-seeded canonical seats (CEO, five Directors, the App Store release lead) show Arabic titles in the UI through a table in `format.ts`; a seat the Founder creates keeps the title it was given.
- Engineering defaults: launch token 90 s, session 8 h / 2 h idle, preview 10 min, attention re-signal cooldown 4 h, CEO brief cooldown 6 h (D-C5-12 item 4).

## 14. Technical spike result (real UI, headless Edge 154 through CDP, before the large build)

| Check | Result |
|---|---|
| Scene boots from the loopback server | PASS — renderer `webgl` (WebGL 2) |
| Arabic and Latin labels are browser-shaped text with the bundled font | PASS — 9 Arabic labels, 3 Latin labels, font loaded |
| Founder centre + orbit levels present | PASS — kinds `founder`, `employee`, `goal`, `attention`; 16 labelled levels |
| No external asset | PASS — 29 requests, 0 external (CSP `default-src 'self'`, verifier rule) |
| Pointer selection → Employee Focus → return to Live | PASS — selection `إيهاب طارق`, lens `EMPLOYEE`, back `LIVE` |
| Reduced motion is a parity mode | PASS — the same pinned label set (12) after settling in reduced mode |

The spike checks stay in `npm run c5:spike` and run in CI's acceptance job on both operating systems.

## 15. Validation record (focused during development; one authoritative heavy gate on the final tree)

| Gate | Result on the final tree (2026-09-29) |
|---|---|
| `npm run build` / `npm run typecheck` | clean (all workspaces, including the browser UI compiled by tsc) |
| `npm run lint` | 0 problems (the UI package under its own DOM-globals / no-Node-import rules) |
| `npm run verify` | 63 / 63 rules; self-test: 62 rules each proved able to fail (the 5 new C5 rules included) |
| C5 unit / integration suites (`node:test`) | governance 7, UI layout 8, storage 8, runtime 3, command-center 9 → 35 passed, 0 failed |
| `npm run c5:mutation` | 16 / 16 mutations caught (authority, privacy, truth and confirmation boundaries; none cosmetic) |
| `npm run c5:acceptance` | `C5 LOCAL ACCEPTANCE — PASS`, 9 / 9 steps, sandbox removed; fake provider only, no network |
| `npm run c5:visual-proof` | `C5 VISUAL PROOF — PASS`: 6 spike checks, Scenario A–H frames, scale frame (87 nodes, 77 employees, minimum employee spacing 0.85 units, layout 4 ms), `walkthrough.mp4` (33 frames, 8 s, 2.1 MB), `manifest.json` |
| Authoritative heavy gate `npm ci` + `npm run ci` | see the closing line of this section |

The focused cadence: the C5 suites, the verifier and the spike were re-run after every correction cycle; the heavy gate ran once on the candidate. Correction cycles per root cause never exceeded two (the two largest were the fake-provider routing in the brief proof and the CDP hand-off of the video frames; both are recorded in section 17's process notes where they changed a script).

**Heavy gate result (2026-09-29, Founder host, Node 24.19.0 / npm 11.17.0):** `npm ci` (114 packages, 0 vulnerabilities) then `npm run ci` → **exit 0 in 1 981 s**: build, typecheck, lint, every workspace test (storage 284, runtime 96, governance / UI / command-center suites), mutation checks c1 6/6 · c2 19/19 · c3 40/40 · r1 45/45 · c4 25/25 · c5 16/16 (all caught), verifier 63/63 with self-test. The first attempt of the gate exposed a stale expectation in the C4 migration proof (`applied` must now include 9); after that one-line correction the gate was re-run in full. `npm run c5:acceptance` was then re-run on the gate-built tree: PASS.

## 19. Branch, head and Draft PR

- Branch `c5/founder-command-center-attention-orbits` from base `ff7f71cc8ed4378469ed23df6f3dadefaba631a8`.
- The exact head SHA and the Draft PR link are recorded in the PR description (a report cannot carry the hash of the commit that contains it). The PR is a **Draft**; it is never merged by the implementer. C6, R2 and C7 are not started.

## 16. Open Product questions (D-C5-12; fail-closed reading implemented)

1. Stage 16 authority is still missing; this candidate follows the C5 brief for lenses, attention lanes and the confirmation boundary.
2. Which company content the Founder surface should hide (reviewer rationale, staffing evidence): C5 shows objectives, goal text and messages only.
3. Budget ceilings stated in another currency than the envelope's are refused (`CURRENCY_MISMATCH`); a conversion policy is a Product decision.
4. The TTL / cooldown defaults listed in section 13 are engineering values.
5. Department goal derivation is open to every Director seat holder pending Stage 10's reading of Engineering.

## 17. Residuals (all MINOR; none reopens the gate)

- Scope entry (`withSession`) re-checks revocation, expiry and principal but not the idle window; every HTTP request verifies the session (which applies the idle window and refreshes `last_seen_at`) before any scope is entered, so no idle session reaches a write.
- The SVG fallback is 2.5D without the volumetric atmosphere by design; it keeps every label, lens, action and the attention rail.
- The walkthrough MP4 needs WebCodecs (Edge / Chrome on the Founder host); CI runs the spike checks only, never the video.
- `fetch` drops a caller-set `Host` header, so the DNS-rebinding proofs send the forged request over `node:http`.
- `three` is served from the workspace's own `node_modules`; `npm ci` on the Founder host is part of the acceptance path.
- The verifier's remote-URL rule exempts `http://www.w3.org/` namespace identifiers (names, never fetched).
- The C4 migration proof `real released v6 → …` now expects the upgrade to apply `[7, 8, 9]`; every C4 assertion in it (adopted Departments, preserved rows, charters, foreign keys, integrity) is unchanged. No released migration was edited.
- The walkthrough is encoded as H.264 Constrained Baseline level 4.0 (1440×900 frames; level 3.1 would close the codec) and the frames are handed to the encoder page in ~1 MB DevTools batches. The clip plays at 4 fps (about 8 s from the captured frames).
- The seeded proof company carries realistic money caps (company 2,000,000 EGP; Department 250,000 EGP; Employee 20,000 EGP) so that Scenario E's "raise the ceiling to 50,000" is a real change inside the Department cap; an instruction that would exceed a parent cap is refused by the engine at confirmation (`BUDGET_EXHAUSTED`, HTTP 409), never silently clamped.
- Process note: a PowerShell rewrite of the test files during lint clean-up double-encoded their Arabic strings (the host shell reads UTF-8 files as Windows-1252); the damage was reversed byte-exactly, every file was re-verified by Arabic character counts and the suites re-run green. The `.gitattributes` / UTF-8 policy is unchanged.

## 18. G1 — concrete effect of each Skill used

| Skill | Where it changed the candidate |
|---|---|
| `impeccable` | Focus panel and attention rail without card scaffolds or eyebrow labels; one authored motion moment (camera focus); themed browser surfaces (`color-scheme: dark`, scrollbar colour) |
| `ui-ux-pro-max` (three.js stack, UX guidelines, motion) | Pinned `three` release with addon-free imports; `setPixelRatio` capped at 2; geometry / material disposal in `dispose()`; 44 px targets and keyboard paths; context-aware durations |
| `frontend-design` | Visual identity plan reviewed against the generic-default tells (no warm-cream serif, no acid-green on black, no SaaS card kit); copy from the Founder's perspective; the activity strip's empty state names its job |
| `dataviz` | Status by shape + words (never colour alone); Department hues assigned in fixed canonical order; legend present |
| `animate` / `emil-design-eng` / `review-animations` | Keyboard-opened palette does not animate; `cubic-bezier(0.23,1,0.32,1)` / `(0.77,0,0.175,1)` tokens; camera focus 560 ms in-out; `transform` / `opacity` only; press feedback `scale(0.97)`; transitions over keyframes; reduced motion as a parity mode |
| `sibawayh:designing-arabic-frontends` | `<html lang="ar" dir="rtl">`, bundled IBM Plex Sans Arabic with line-height ≥ 1.6, logical properties, one numeral / calendar policy (`ar-EG-u-ca-gregory`) in one formatter, LTR islands for IDs and codes, no letter-spacing on Arabic, labels never rendered as WebGL text |
| `sibawayh:writing-eloquent-arabic` | Founder-facing strings written in Arabic structure (rail, focus, preview, empty states, errors); فصحى for governed confirmations, warm register for navigation |
| `artifact-diagramming` | The architecture figure in section 5 |
| `github-actions` | Matrix / acceptance changes in `ci.yml` without weakening any gate |


## 20. Presentation correction (Attention Orbits comprehensive visual UX correction v1)

A second pass on the same branch and Draft PR, on the Founder's correction brief. It changes presentation only: the
runtime, the storage schema, migration 0009, authentication, the Goal semantics and the interaction model are
untouched (no file under `packages/storage`, `packages/runtime` or `packages/governance` changed). Where this
section contradicts an earlier section about the interface language, this section wins.

### 20.1 Presentation audit of the previous proof (before the change)

| # | Finding in the previous frames | Severity |
|---|---|---|
| 1 | The application chrome was Arabic and the layout RTL; the brief wants an English, LTR application with Arabic only inside message content | MAJOR |
| 2 | The map lived inside a dashboard: the attention rail always open, two bottom cards, a permanent scrubber, a counts line under the brand | MAJOR |
| 3 | Rank was not readable from the orbits: no ring names, faint rings, nodes of similar size | MAJOR |
| 4 | Sectors were faint tinted wedges without names; a group of people could not be assigned to a Department at a glance | MAJOR |
| 5 | The Founder was an over-sized glowing sun (0.62 core, 6.5-unit halo) that swallowed the CEO orbit | MAJOR |
| 6 | Nodes were plain spheres: identity, level, department, state and live activity were not a system | MAJOR |
| 7 | Goals were a slim white pillar over a ring, alone in space, with no visible link to the Departments serving them | MAJOR |
| 8 | Messages were generic bubbles and a select + textarea form; briefs were a two-column definition list | MAJOR |
| 9 | Raw identifiers and codes reached the Founder (UUIDs in the preview, `model.invoke (R0)`, `role:growth.seo-specialist`, a preview fingerprint) | MAJOR |
| 10 | The five Department hues failed the dataviz palette validator (pink ↔ green ΔE 2.6 under deutan; every hue outside the dark-surface lightness band) | MINOR |
| 11 | Background: a dark gradient with 520 motes read as a starfield; little depth or light | MINOR |
| 12 | Empty states and notes were generic ("nothing moved yet…") and the eyebrow labels over headings remained | MINOR |

### 20.2 What changed

- **English application, content as written.** `<html lang="en" dir="ltr">`; every string of the chrome, the sheets,
  the palette, the preview and the notes is English (`format.ts` holds one wording table per code family, and an
  unknown code is spelled into words, never shown as a code). Company content (names, objectives, goal text,
  messages) renders as written: `dirOf` picks the direction from the first strong character, Arabic blocks get
  `dir="rtl" lang="ar"` and the Arabic line-height, the composer and the palette are `dir="auto"`. The command
  grammar was already bilingual; the proof now drives it in English and the acceptance in both.
- **The universe is the product.** The attention rail opens from a top-bar control (with a count) or from a lens
  and closes with Escape; the bottom edge holds a small time pill (the scrubber appears on hover, focus or in
  Historical Focus), an "Upcoming" dock and a transient activity note; the counts line moved into the top bar as
  one quiet sentence. No permanent panel remains.
- **Rank from the orbit.** One tag per orbit (CEO, Directors, Managers & Leads, Specialists) placed on the
  orbit line at a sector boundary (seat-free by construction); ring lines with the CEO orbit stronger,
  alternating orbit bands, and node cores sized by rank (0.42 / 0.34 / 0.27 / 0.22).
- **Department from the sector.** A coloured rim arc per sector at radius 12.1 carrying the Department's name and
  its head-count (a real button: it opens the Department), sector fields gathering strength toward the rim, and
  hairline separators from the Director orbit to the rim, all in one anti-aliased plane shader. The palette is
  the dataviz-validated set `#3987e5 #199e70 #c98500 #9085e9 #d95926` (every adjacent pair around the ring,
  including the wrap, ΔE ≥ 8.4 under CVD and ≥ 19.8 in normal vision; L 0.48–0.67; ≥ 3:1 on the surface).
- **Founder as centre of gravity, not a sun.** A 0.5 core with a thin seal ring, a 3.4-unit halo at 0.42 opacity,
  a modest key light.
- **Node system.** Core (department hue, physical material with clearcoat), a seat ring on the plane in the
  department hue, a soft ground shadow, status rings (hollow / broken / double / dashed, unchanged semantics), a
  circling arc for running work (a real state; static in reduced motion), the selection ring and depth-scaled
  captions (`--depth` from the camera distance).
- **Goal beacons.** A faceted gem over a pool of light with a slender beam, one tether per anchored Department to
  that Department's rim (brighter in Goal Focus), proposed goals dimmer and translucent; anchored goals stand a
  quarter radian clockwise of their Departments' mean angle so the sector name and the beacon never share a spot
  (`GOAL_LEAD`; D-C5-09 amended in D-C5-13).
- **Conversation.** A ledger, not bubbles: the counterpart's identity (initials in the department hue, seat,
  department), the work they carry as context chips, a one-line rule that conversation never grants authority,
  entries with the sender by name and hue, the purpose named, the time, the body as written; the Founder
  Communication Standard brief as four titled parts; a composer with purpose chips, a bilingual textarea and
  Enter-to-send. The same brief component renders in the attention rail.
- **Atmosphere.** A deep ink-to-haze gradient with two slow, very large light fields (cool and warm), a horizon
  band, a pool of light where the camera looks, film grain against banding, 220 far dust motes (no starfield,
  no neon), fog, a lower camera elevation and stronger pointer parallax; reduced motion stills all of it.
- **No code leaks.** Preview fields are named and identifiers resolved (budget holder → a name) or dropped;
  capabilities read as words ("Model calls (R0) · Notes (R1)"); the role row is gone; escalations name the work.
- **Empty states and notes** say what the surface is for and what to do next; eyebrows over headings are gone.

### 20.3 Validation (focused, per the brief; GitHub CI on the exact head is the full gate)

- `command-center-ui` build + typecheck + tests: 9/9 (one new proof: running state, goal anchors, English structural
  labels); `command-center` typecheck + tests: 9/9 (index served as `lang="en" dir="ltr"`).
- `eslint --max-warnings=0` on `packages/command-center-ui`, `packages/command-center`, `scripts`: clean.
- `c5:spike`: 6/6 (scene boots; English UI with content as written; four ring tags and five sector names; no
  external asset; selection / focus / return; reduced-motion parity now including ring and sector names).
- `c5:visual-proof`: PASS — eleven frames (Company Live, Employee Focus, Goal Focus, Conversation with Arabic and
  English messages inside the English sheet, Founder Attention, governed preview and confirmation, Historical
  Focus, reduced motion, SVG fallback, a scale frame over a really seeded 77-person company with no overlap), a
  10 s walkthrough MP4, a before/after board and the manifest; the preview is checked for identifier leaks and the
  conversation for per-message direction (`rtl` for Arabic bodies, `ltr` for English) inside an `ltr` sheet.
- `c5:acceptance`: PASS 9/9 (the governed action now driven by an English instruction, the read command in Arabic).
- `verify-bootstrap`: 63/63.
- Not re-run locally by instruction: the full `npm run ci` (33 min); the mutation shards run in CI on the exact head.

### 20.4 G1 — Skills used in this pass and their concrete effect

| Skill | Effect |
|---|---|
| `impeccable` | Mode: Operate. The audit above, then the craft floor: no eyebrow labels, no nested cards, no `border-left` accents, themed browser surfaces, one authored motion (camera), bounded inspection rounds (three rounds of real frames, fixes batched) |
| `frontend-design` | The plan reviewed against the generic tells; copy from the Founder's perspective (controls name their action, empty states invite action) |
| `dataviz` | The validator (`validate_palette.js`) rejected the old hues and shaped the new five, run in ring order with the wrap; department is never colour alone (position + named rim) |
| `emil-design-eng` / `animate` | Sheets enter with `@starting-style` (220 ms, `cubic-bezier(0.23,1,0.32,1)`), the toast and scrubber reveal in ≤ 220 ms, press feedback, transitions over keyframes, `transform` / `opacity` only, reduced motion gentler not zero |
| `sibawayh:designing-arabic-frontends` | Arabic content inside an LTR application: block-level `dir` from the first strong character, `lang="ar"` for font fallback and screen readers, Arabic line-height 1.8, `unicode-bidi: plaintext`, no letter-spacing on anything that can hold Arabic (the uppercase tracking is on Latin-only map tags), `dir="auto"` inputs |
| `sibawayh:writing-eloquent-arabic` | Not applied to the chrome (now English); the Arabic in the seed (the Founder's question, the CEO's answer and brief) kept its native structure |
| `ui-ux-pro-max` | The search tool needs Python, which the Founder host does not have; its priority table was applied by hand (contrast, 36–44 px targets, visible labels, no icon-only controls, context-aware durations) |

### 20.5 Residuals of this pass (MINOR)

- In Goal Focus at the near tier a specialist caption can touch the far-side sector name; captions never cover
  the rim itself.
- The SVG fallback keeps the named rims, tethers and beacons in 2.5D without the atmosphere, by design.
- `seedScale` (the scale frame) opens a second store connection beside the running runtime, as an administrative
  tool would; it is proof tooling only.


## 21. Presentation reset — Tree of Light (QANDEEL_COMPANY_C5_TREE_OF_LIGHT_PRESENTATION_RESET_v1)

The Founder rejected the orbital / galaxy presentation as the primary company view and selected the Tree of Light
direction: **Founder at the top → CEO beneath → five Department columns → goals along the bottom → gold execution
lines from work to goals.** This section records the reset on the same branch and Draft PR. Where it contradicts
sections 2–20 about the main view, this section wins. Sections 13–20 remain the record of the runtime, storage,
authentication, Goal, attention, communication and governed-action work, which this reset preserves.

### 21.1 What changed visually

- **Home / Company Live** is now a structured executive surface, DOM + SVG: the Founder emblem at the top with
  "what needs you" beside it (compact chips; the full attention rail opens from them), the CEO card beneath on
  one gold trunk, five Department columns branching from the CEO (name, colour accent, head-count, the Director
  first, then Managers / Leads, then Specialists, vacant seats dashed in place, acting cover marked), and the
  **Strategic direction** band pinned to the bottom of the view with the goals as mission objects (company goals
  primary, Department goals secondary, proposed goals outlined "awaiting your decision", progress from linked
  work, the Departments serving each goal as chips). Gold execution lines run from each column that serves a goal
  to that goal (one bundled line per column and goal, its weight by the number of people serving); when work runs
  now, a light travels along the line. ◆ on a card marks a person whose work serves a goal.
- **No WebGL, no vendor library.** `three` is removed from the UI package, the lockfile, the static server and the
  verifier allow-list; the server serves the UI's own files only. The renderer contract, WebGL scene, SVG 2.5D
  fallback and label layer are gone: one view serves every capability, so there is nothing to fall back from.
- **Lenses adapted, behaviour kept.** Employee Focus lights the person, their reporting chain up to the Founder
  (cards gain a gold edge), their live relations (drawn only on focus surfaces) and the goals their work serves;
  everything else quiets. Goal Focus keeps the goal, its derived goal, its serving people and their leadership
  and brightens its execution lines; unrelated columns and goals quiet. Department, CEO, Blocked, Attention and
  Historical Focus map the same way. Focus scrolls the surface to the selected card (a cut in reduced motion).
- **Theme.** A light executive surface (warm paper neutrals, ink type, one gold, five Department accents validated
  with the dataviz palette checker on the light surface: L 0.43–0.77, ≥ 3:1, adjacent CVD ΔE ≥ 7.8 with the
  column name as the secondary encoding). Ambient life is one very slow drift of the surface light; semantic motion
  is the focus scroll, the lit paths, a relation pulse, an arriving attention chip and the flow along a running
  execution line. Reduced motion keeps every mark and removes every tween and the drift.
- **Conversation** keeps the ledger of section 20 on the light theme; the draft and its purpose now survive the
  live refreshes of a working company.
- **Scale.** Columns grow downward and the view scrolls under the pinned goal band; the scale frame shows a
  really seeded 77-person company with the same five columns.

### 21.2 What stayed intact

Authentication and sessions, Goal durability and semantics, Founder Attention behaviour, the CEO proactive brief,
direct Founder ↔ Employee communication, governed action preview / confirmation, timeline / history, the C5 truth
model, migration 0009, the runtime, governance and storage packages (no file under `packages/storage`,
`packages/runtime` or `packages/governance` changed), the command grammar, the acceptance harness and the CI
gates (the smoke step is bounded to eight minutes; nothing was removed or made optional).

### 21.3 Files changed (presentation reset)

`packages/command-center-ui/src/model/{types,layout,lenses}.ts` (the column layout model, lenses over it),
`src/app/view.ts` (new: the Tree of Light view), `src/app/main.ts`, `src/app/panels.ts` (draft survives refresh),
`src/index.ts`, `public/{index.html,styles.css}`, `package.json` (no dependency), `test/layout.test.ts` (rewritten
proofs); removed `src/app/{scene,svg-renderer,labels,renderer}.ts`; `packages/command-center/src/{static,index}.ts`
(no vendor route), `test/surface.test.ts`; `package-lock.json`; `scripts/c5-visual-proof.mjs`,
`scripts/c5/before-after.mjs`, `scripts/c5-mutation-check.mjs` (`c5-rank-order-flattened`,
`c5-department-column-collapsed` replace the orbit gates), `scripts/verify-bootstrap.mjs` (proof marker
`tree-of-light-layout`, pinned mutation ids, no package dependency), `.github/workflows/ci.yml` (smoke step
name and timeout), `README.md`, this report, `DECISION_LOG.md` (D-C5-14).

### 21.4 Focused validation (GitHub CI on the exact head is the full gate)

- `command-center-ui` build + typecheck + tests 8/8 (leadership spine; columns in canonical order led by their
  Director; rank order never by code; seats own their row; goals anchored and served through durable links with
  progress from work states; edges only from live relations; scale; lenses).
- `command-center` build + tests 9/9. `eslint --max-warnings=0` clean. `verify-bootstrap` 63/63 with self-test.
- `c5:mutation` 16/16 caught (including the two new layout gates). `c5:acceptance` PASS 9/9.
- `c5:visual-proof` PASS: smoke 6/6 (the surface renders — spine, five columns, goals, execution lines; English
  chrome with content as written; structure named; no external asset; selection quiets visibly and returns; the
  surface is never rebuilt without a change; reduced-motion parity of every mark), ten frames, a walkthrough MP4,
  the before/after board against the orbital proof, the manifest.
- Why the previous CI runs failed, and the fix: the Windows smoke ran the WebGL scene under software rendering and
  hit the job limit (no GPU is needed now, and the step is bounded); the `c5-rank-radius-inverted` mutation
  searched a radius the correction had changed (the orbit gates are replaced by the column gates).
- A headless finding worth recording: a background headless tab advances its animation clock only when it paints;
  the proof's settle now drives frames, so CSS transitions are seen as a visible tab would see them.

### 21.5 G1 — Skills, used or not, and their effect on the reset

| Skill | Used | Effect |
|---|---|---|
| `impeccable` | used | Operate mode; the audit of the orbital frames; the craft floor (no eyebrow labels, no nested cards, no `border-left` accents, themed browser surfaces, one authored motion); three bounded inspection rounds on real frames |
| `frontend-design` | used | The plan reviewed against the generic tells; the surface's own vocabulary (Strategic direction, Needs you, Talk to Hany); copy that names its action |
| `dataviz` | used | The light-surface palette validated with `validate_palette.js`; Department never colour alone; progress drawn to scale |
| `emil-design-eng` / `animate` | used | Transition ingredients (160–220 ms, strong ease-out), press feedback, transitions over keyframes, `transform` / `opacity` only, reduced motion gentler not zero; the flow along a running line as state indication |
| `review-animations` | used as the checklist | Every transition property named, no `ease-in`, no `scale(0)`, keyboard palette does not animate |
| `sibawayh:designing-arabic-frontends` | used | Arabic content inside an LTR application: per-block `dir` and `lang`, Arabic line-height, `unicode-bidi: plaintext`, no letter-spacing on anything that can hold Arabic, `dir="auto"` inputs |
| `sibawayh:writing-eloquent-arabic` | not used | The chrome is English; the Arabic content in the seed is unchanged |
| `ui-ux-pro-max` | partly | Its search tool needs Python (absent on the Founder host); the priority table was applied by hand (contrast, targets, visible labels, context-aware durations) |
| `artifact-diagramming`, `github-actions` | not needed | No new diagram; the CI change is a step name and a timeout |

### 21.6 Residuals (MINOR)

- At very narrow widths the columns wrap to fewer per row (three, two, one); the goal band stays pinned.
- The walkthrough is captured at a few frames per second (about 6 s at 4 fps).


## 22. Final visual craft pass — Tree of Light (QANDEEL_COMPANY_C5_TREE_OF_LIGHT_FINAL_VISUAL_CRAFT_PASS_v1)

The Tree of Light is the accepted and now frozen presentation. This pass raised its craft without touching its
structure (Founder → CEO → five Department columns → people → Strategic direction → gold execution lines) and
without touching storage, runtime, governance, authentication, migration 0009, Goal semantics, Founder Attention
semantics, communication authority or the privacy rules. Where it contradicts section 21 about details of the
surface, this section wins.

### 22.1 Craft audit of v3 (what the frames showed)

Company Live: the CEO → Department branches were five thin coloured curves meeting in a knot; column names were
tracked uppercase eyebrows; each card carried a floating status dot and a ◆ stacked at its right edge; the
execution lines curved across columns and the "flowing" overlay read as a dashed line. Employee / Goal Focus: a
generic white panel that covered two columns and part of the goal band, with unnamed "Serves a goal" links and
no visible tie to the selected card. Conversation: a side-panel ledger with the authority rule as a paragraph on
top and a generic composer. Founder Attention: a full-height left rail covering two columns, the brief stacked
like an e-mail, and nothing in the company responding to the item being read.

### 22.2 What changed, by target

- **Company Live.** One gold leadership system: a straight trunk (with a soft halo) from the Founder to the CEO,
  then an orthogonal gold bus with rounded turns from the CEO into every column, each column's own accent only at
  its port. Columns are fields (the Department's light at the top fading to paper, a hairline under a
  sentence-case header with a colour mark, name and head-count, the Director first on a lane in the accent).
  Cards carry the person: a rounded-square avatar in the Department tint (solid for Directors and the CEO), the
  status as a dot at the avatar's corner (green well, blue running with a circling ring, amber awaiting, red
  blocked, hollow for a vacant seat, a double ring for acting cover), one tag only when it says something, a gold
  diamond when the person serves a goal. Depth is one material: paper, a soft offset shadow, hairlines.
- **Gold execution lines.** Each goal owns a collector rail just above the Strategic direction; every serving
  column drops into it (weight by the people serving, ports fanned so drops never overlap), and one bundle
  weighted by everyone enters the goal. Rails and bundles draw above the pinned band with a paper casing (a road
  on a map), structure draws under the cards. A running column sends one light along its line (`pathLength`
  dash). A selected goal's lines are lit; unrelated lines quiet to a tenth. A derived Department goal hangs from
  its parent by a dashed link that runs beneath the goal objects, never across another goal.
- **Goals / Strategic direction.** A left-hand title block ("Strategic direction — where the work is going") and
  the goals as mission objects: emblem, title first, then a status line (Active / Awaiting your decision, kind,
  owner with initials, horizon), the serving Departments as accent chips, progress as a bar with the people
  count. Company goals are warm and raised, Department goals subordinate, proposed goals dashed and hollow.
- **Employee Focus.** A context sheet docked beside the company, stopping above the goal band (it reads the
  band's height), on the side that keeps the person visible (right-hand columns get the sheet on the left), with a
  gold tether from the selected card to the sheet. Header washed in the Department accent with the same avatar as
  the column; "Reports to" as a lane of people (avatar, name, kind) up to the Founder; work rows that name the
  goal they serve; live relations as people; authority as a budget meter and capability chips; "Talk to X".
- **Goal Focus.** The same sheet in gold: emblem, kind and state, horizon, summary, success criteria, the path
  from goal to action (owner as a person, serving Departments as accent chips, work items with their owner and
  state, reviews and approvals), derived goals, the approve action for a proposed company goal.
- **Conversation.** An operating ledger inside the company: the counterpart's identity with role, Department and
  reporting line ("reports to you" for the CEO), what they carry now and the goals it serves, day separators,
  entries with the sender's avatar, name, purpose and time (the Founder's entries on a warm wash, never bubbles),
  a brief as an executive memo, the newest exchange kept in view, and a composer addressed "To Ehab, as
  Question" with "Send to Ehab" and the authority rule as a footnote.
- **Founder Attention.** Idle: compact chips beside the Founder (kind, subject, one verb — Decide / Urgent /
  Look / Read); resting on one spotlights where it lives (the person, their chain, their Department, the goal it
  is about) and tethers the person to the chip — emphasis only, through `attentionSpotlight`, attention
  semantics untouched, and it survives the live refreshes of a working company. Open: a surface anchored beside
  the Founder over the dock (about a fifth of the stage, the Founder in view), segmented lanes, items as executive
  rows (level mark, kind, owner, time, the ask in one line, the brief as a four-part memo), actions Decide /
  Reply / Show in company / Dismiss; reading an item spotlights it in the company the same way.
- **Typography / motion.** No tracked uppercase labels remain (the wordmark keeps its tracking; Arabic never
  receives letter-spacing); one type scale; sentence case everywhere. Motion: 160–220 ms strong ease-out
  transitions on named properties, sheets enter from their own side (`@starting-style`), the attention surface
  scales from its origin, hover lifts gated to fine pointers, reduced motion keeps every mark.

### 22.3 What stayed intact

Everything section 21.2 lists, plus the Tree of Light structure itself: no file under `packages/storage`,
`packages/runtime`, `packages/governance` or `packages/command-center/src` changed; the lenses' semantics are
unchanged (one pure addition, `attentionSpotlight`, with its own proof); the acceptance harness and the CI gates
are unchanged.

### 22.4 Files changed

`packages/command-center-ui/src/app/{view,panels,main}.ts`, `src/model/lenses.ts` (`attentionSpotlight`),
`src/index.ts`, `public/{styles.css,index.html}`, `test/layout.test.ts` (one new proof, 9 in all);
`scripts/c5-visual-proof.mjs` (final frame set, close-ups, spotlight and tether checks, Animation domain no
longer enabled), `scripts/c5/before-after.mjs` (v3 → final pairs, light board); `README.md`; this report;
`DECISION_LOG.md` (D-C5-15).

### 22.5 Focused validation

UI build + typecheck + tests 9/9 · `command-center` tests 9/9 · `eslint --max-warnings=0` clean ·
`verify-bootstrap` 63/63 · `c5:mutation` 16/16 caught · `c5:acceptance` PASS 9/9 · `c5:visual-proof` PASS
(smoke 6/6 with the tether and "sheet clear of the goal band" checks; 13 frames and 2 close-ups; walkthrough;
before/after board v3 → final; manifest). Full `npm run ci` runs on the exact head in GitHub CI.

### 22.6 G1 — Skills found, used, and their concrete effect

| Skill | Used | Effect on this pass |
|---|---|---|
| `impeccable` | used | Operate mode; the v3 audit (22.1); the craft floor drove the removal of eyebrow labels, the offset shadows, one material, themed browser surfaces; two bounded inspection rounds on real frames, one fix batch each |
| `frontend-design` | used | The plan reviewed against the generic tells (no all-caps labels, no dot-joined meta strings on the goals, no hero-metric tiles); copy that names its action (Send to Ehab, Show in company, Decide) |
| `dataviz` | used | The Department accents kept as validated; progress and the budget meter drawn to scale; identity never colour alone (name beside every accent) |
| `emil-design-eng` / `animate` | used | Transition ingredients (160–220 ms, `cubic-bezier(0.23, 1, 0.32, 1)`), named properties only, `@starting-style` entrances, press feedback, hover gated to fine pointers, transitions over keyframes for anything rapid |
| `review-animations` | used as the checklist | No `ease-in`, no `scale(0)`, no keyboard-triggered motion, reduced motion gentler not zero |
| `sibawayh:designing-arabic-frontends` | used | Arabic content inside the LTR application: per-block `dir` and `lang`, Arabic line-height, `unicode-bidi: plaintext`, no letter-spacing on anything that can hold Arabic, `dir="auto"` composer |
| `sibawayh:writing-eloquent-arabic` | not used | The chrome is English; the Arabic content in the seed is unchanged (one new Arabic message in the proof, written for the ledger) |
| `ui-ux-pro-max` | partly | Its search tool needs Python (absent); its priority table applied by hand (contrast, 36 px targets, visible labels, no horizontal scroll, context-aware durations) |
| `artifact-diagramming`, `github-actions`, React Native / Expo Skills | not needed | No diagram, no workflow change, no native surface |

### 22.7 Residuals (MINOR)

- ~~A sheet docked on the far side of its subject is tethered across the company by a dashed hairline (it crosses
  the columns between).~~ Corrected in §23.
- ~~The sheet docked on the right covers the "Needs you" chips; the attention surface and the topbar button
  remain.~~ Corrected in §23.
- The walkthrough plays at 4 fps (about 11 s); the first two proof steps take ~20 s because the walkthrough
  capture forces a paint every 250 ms. Proof-only; kept (§23.3).

## 23. Final MINOR visual residual correction (QANDEEL_COMPANY_C5_FINAL_MINOR_VISUAL_RESIDUAL_CORRECTION)

Starting exact head `d833a8c1a73f3808b6ddb001276cd94dd56cdf54`. The Tree of Light is APPROVED / FROZEN: this
correction fixes the two real visual collisions left in §22.7 and nothing else. No layout, copy, motion,
runtime, storage, governance or authentication change; the Founder, the CEO, the five columns, the Strategic
direction, the goal objects and the gold execution lines are exactly as they were.

### 23.1 Tether routing (the leader)

The tether from a selected card to its context sheet (and from an attention chip to the person it concerns) was
a dashed Bézier from the card's centre straight to the sheet: on the far side it crossed the person cards of the
columns between, and from a goal it crossed the goal beside it. It is now a **leader**, routed by
`TreeView.#leaderRoute` and split by `splitLeader` (`view.ts`, with its own pure proof):

- a person or the CEO leaves from the side edge on the sheet's side, **on their own row**, straight to the
  sheet's near edge; when the sheet has no room on that row (a chip, a sheet that starts lower) the leader steps
  over in the **nearest column gutter** first (at most two right-angle turns, never a diagonal);
- a goal leaves from its **top edge at the column gutter nearest the sheet** (never through the goal beside it)
  and joins the sheet's side edge above the rails; a sheet standing over the goal takes a short vertical;
- an attention chip is joined from the person's row through the gutter on the chip's side and entered from
  below (or from its near side), passing beneath the other chips;
- every piece that would cross a card, a column head, a goal or a chip (blocks padded by 3 px) is drawn in the
  **under-layer** beneath it, the rest over the surface: nothing on the surface is written over, and the leader
  reads as running behind the objects it passes. It keeps its dotted hairline (`2 6`, 1.5 px, no casing, no
  arcs), so it is never mistaken for a gold execution line or a derivation.

### 23.2 Context sheet vs the Founder's "Needs you" chips

- The **CEO's sheet docks on the left** (the desk left of the spine is empty; the right holds what needs the
  Founder): the Founder ↔ CEO conversation keeps its full height and never touches the chips.
- A sheet that docks **on the right** (a person in the left-hand columns, a goal served there) is
  collision-aware: when its box would meet the chips, it gets `is-below-desk` and starts beneath them
  (`top: calc(var(--desk-b) + 10px)`, the desk's bottom measured live by the view, like `--goals-h`, on
  resize and scroll). The chips stay whole, discoverable and hoverable while the sheet is open — resting on one
  still spotlights where it lives, with its own leader — and the sheet returns to its full height when the
  attention surface replaces the dock. No chip moves; nothing is hidden.

### 23.3 Walkthrough capture (proof only)

Unchanged at 4 fps, recorded as proof-only MINOR: each capture is a forced software paint of ~160 ms on the
headless tab, so a faster fixed cadence cannot be honoured, and a screencast with per-frame timestamps would
change the encoder page and the harness. Product motion is untouched.

### 23.4 Files changed

`packages/command-center-ui/src/app/view.ts` (leader route, `splitLeader`, `--desk-b`), `src/app/main.ts`
(docking rule, `is-below-desk`), `public/styles.css` (two rules), `test/layout.test.ts` (one new proof, 10 in
all); `scripts/c5-visual-proof.mjs` (`--minimal`, leader-crossing and chips-clear checks, the sheet-beside-chips
frame); `README.md`; this report; `DECISION_LOG.md` (D-C5-15 addendum).

### 23.5 Focused validation and proof

UI build + typecheck + tests 10/10 · `eslint --max-warnings=0` clean · `c5:visual-proof --minimal` PASS (smoke
6/6; Company Live, Employee Focus with the leader crossing nothing and the sheet below the desk, Goal Focus with
the goal leader crossing nothing, Founder Attention compact, the sheet beside the chips: `chipsClearOfSheet`
and `leaderCrossings: 0` on every frame) · the full `c5:visual-proof` run once as validation (the CEO sheet
docked left, Founder ↔ Employee in Arabic on the left with its leader beneath the cards it crosses).

### 23.6 G1 — Skills used, proportional to the scope

| Skill | Used | Reason |
|---|---|---|
| `impeccable` | used | The craft floor's reflexes for annotation lines (a leader is subordinate: hairline, no casing, passes beneath objects, never a work line); one bounded inspection round on the real frames |
| `emil-design-eng` | used | No new motion: the sheet's shelf change is instant (a position, not a tween), transitions stay on named properties; nothing keyboard-triggered animates |
| `ui-ux-pro-max` | used by hand | "Focus not obscured": the chips remain visible and reachable while a sheet is open; targets unchanged |
| `frontend-design`, `animate`, `review-animations`, `dataviz`, `sibawayh:*` | not needed | No new surface, no motion change, no chart or palette change, no Arabic copy touched |

## 24. Windows browser-smoke corrections: a bounded harness, a state-aware reduced-motion smoke, and the line-layer growth defect they uncovered

Three bounded corrections on the frozen Tree of Light, each started at the exact head the Founder named
(`45a51fcc` → `586ffd10` → this commit). The first two were harness-only; the third is the one Product fix
this cycle, authorized by the Founder after the investigation proved the defect in the Product itself.

### 24.1 The harness fails bounded (`586ffd10`, QANDEEL_COMPANY_C5_WINDOWS_BROWSER_SMOKE_HANG_CORRECTION)

Windows CI twice sat silent after `spike-no-external-asset` until the step's 8-minute ceiling. The proven cause
on the harness side: `CdpConnection.send` had no timeout, so a browser that stopped answering left the harness
waiting forever with no name for what it waited on. Every DevTools command is now bounded
(`DEFAULT_TIMEOUT_MS` 20 s, `QANDEEL_CDP_TIMEOUT_MS`); an unanswered command rejects with a `CdpTimeoutError`
(`code: 'CDP_TIMEOUT'`, the method, the timeout, the helper and step that issued it, crash / detach events the
connection saw, how many other requests were pending) and is removed from the pending map; close and socket
close reject everything in flight; a timeout in the proof runs a bounded post-mortem (does the browser answer,
does the page answer). Every proof helper is wrapped (`traced`) so its name and step ride on each command; the
in-page `settle` / `untilPainted` waits carry their own fallback timers with the command bounded a little beyond
them. `scripts/c5/cdp.test.mjs` (3 tests, `npm run test:harness`, part of `npm test`) proves the bound, the
message and the pending map against a WebSocket peer that never answers. With this in place the next Windows run
showed the truth: selection PASS (47 s, against 3.7 s on Ubuntu), then reduced-motion FAIL, deterministic.

### 24.2 The reduced-motion smoke is state-aware (QANDEEL_COMPANY_C5_REDUCED_MOTION_SMOKE_STATE_AWARE_CORRECTION)

Root cause confirmed exactly as the Founder stated: the Windows runner reports `prefers-reduced-motion: reduce`,
the application honours it on start (`main.ts`: stored preference, else the media query) and starts `reduced`;
the smoke clicked the toggle blind expecting `reduced` and got `full`; `drift none` in app full mode is expected
while the OS still says reduce (the stylesheet's `@media` block honours the OS). The smoke now reads
`data-motion`, the media query and the toggle's `aria-pressed`, saves the initial mode, drives the real toggle to
`reduced` only when needed (`setMotion`: one click, then an explicit bounded wait for dataset and `aria-pressed`
to agree; on failure the error states the initial mode, the target, the OS preference and the observed
`aria-pressed`), proves parity there (every mark stays; drift none, scroll auto, card tween 0 s), exercises the
toggle to `full` (marks stay; drift resumes only when the OS does not prefer reduce), and restores the initial
mode and removes the stored preference it created. `QANDEEL_BROWSER_ARGS` (harness-only) reproduces the runner
locally with `--force-prefers-reduced-motion`. Initial Windows runner preference observed by the smoke:
**app `reduced`, OS `reduce`, aria-pressed `true`**.

### 24.3 The Product defect: the line layer grew without bound (authorized Product fix)

Reproducing the runner locally made the reduced-motion step fail as a bounded `CDP_TIMEOUT` in `settle(300)`
with every command slowing geometrically (1.0 → 1.6 → 2.2 → 2.9 → 5.4 → 7.5 → 9.4 s) until the browser stopped
answering. A direct measurement of the real surface found the cause in `TreeView.#drawLines`
(`packages/command-center-ui/src/app/view.ts`): the line layer's height was derived from the company's
`scrollHeight`, but the layer (absolute, `inset: 0`, sized by its `height` attribute) is itself the company's
largest overflow, so every redraw read back its own previous height and added one band plus 8 px, a feedback
loop with no bound. Every live refresh, scroll, resize and selection redraws the layer.

| | old formula | new formula |
|---|---|---|
| height | `max(company.scrollHeight, ceil(company.height)) + band.height + 8` | `floor(max(company.height, band.bottom − company.top))` |
| width | `max(company.scrollWidth, ceil(company.width))` | `floor(company.width)` |

The new size comes from layout rects only (the company box and the goal band it must cover, one rounding of
the union's edge), so the layer can never feed back into its own measurement. It rounds **down** because the
investigation found a second, smaller instability once the growth was gone: a layer that reaches even a
fraction of a pixel past the boxes it covers (the band's bottom edge is fractional, 843.53 px in the proof
viewport) opens the surface's thin vertical scrollbar, whose 10 px open the horizontal one, which shrinks the
company by 10 px, which the resize observer answers with a redraw 10 px smaller, which closes both again: an
endless redraw at frame rate, the layer alternating 844 ↔ 834 (and, on the old formula, 845 ↔ 835 under the
growth). The layer paints with `overflow: visible`, so its size never clips a line; only the scroll extent it
creates matters, and it now creates none.

Measured on the real surface at 1440 × 900 (line layer height / company scroll extent / surface scroll extent):

| phase | before (HEAD `586ffd10`) | after |
|---|---|---|
| after load | 1 073 / 1 073 / 1 073 | 843 / 843 / 844 |
| CEO selected | 3 946 / 3 946 / 3 946 | 843 / 843 / 844 |
| after return (before: sampled 8 s later, idle) | 25 162 / 25 162 / 25 162 | 843 / 843 / 844 |
| after 20 forced redraws | 30 245 / 30 245 / 30 245 | 843 / 843 / 844 (all 20 redraws: 843) |

This defect explains the original 8-minute Windows hang (the browser crawled, nothing timed out), the 47 s
selection step on the runner, the local reduced-start timeout, and the "proof extremely slow" symptom recorded
earlier against the Animation domain. No layout semantics, visual design or motion behaviour changed: the same
lines are drawn at the same coordinates; the only visible difference is that the surface no longer degrades.

### 24.4 Regression proof

`spike-line-layer-bounded` (in `c5:spike` and the full proof, between selection and reduced motion): reads the
layer's size attributes, the company's scroll extent, the surface's scroll extent and visible size, and the
union of the company box and the band at load, after selecting the CEO, after returning, and after twenty
forced redraws (a scroll event per frame, the way the surface schedules its own draws, each allowed to paint;
the height recorded after every one). It fails if any redraw produced a different height, if the layer is not
exactly the rounded-down union, if either scroll extent grew, or if the visible surface changed size (scrollbars
came and went). Proven red on the previous `view.ts` (the layer 5 935 px at load, 23 615 px after the twenty
redraws, +221 px on every one of them) and on the intermediate rounded-up formula (844 ↔ 834 alternating),
green on the committed one.

### 24.5 Files changed

`packages/command-center-ui/src/app/view.ts` (the one formula in `#drawLines`); `scripts/c5-visual-proof.mjs`
(state-aware reduced-motion parity and J-frame, `motionState` / `setMotion` / `motionStyles`,
`lineLayerGeometry` / `forceRedraws`, the new step); `scripts/c5/cdp.mjs` (`QANDEEL_BROWSER_ARGS`); `README.md`;
this report; `DECISION_LOG.md` (D-C5-16). Runtime, storage, governance, authentication, CSS and `main.ts`
untouched; the quality gate and the Windows matrix leg unchanged (no `continue-on-error`, no raised timeout).

### 24.6 Focused validation

UI build + typecheck + tests 10/10 · `eslint --max-warnings=0` clean · `test:harness` 3/3 · `c5:mutation` 16/16
· `verify` 63/63 · `c5:spike` PASS in the host's default condition (starts `full`: toggle clicked both ways,
drift resumes) and PASS with `--force-prefers-reduced-motion` (starts `reduced`, OS reduce: `toReduced:
already`, toggle to `full` and back, drift stays none; reduced-motion step 1.2 s). GitHub CI on the exact head
is the full gate.

### 24.7 Residuals

None material. The 4 fps walkthrough (§23.3) stays a proof-only MINOR.
