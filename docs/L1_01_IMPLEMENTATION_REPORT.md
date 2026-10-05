# L1-01 Implementation Report — DeepSeek V4.1 Flash Live Provider + Windows Secure Vault + First Local Bring-Up

**Status:** IMPLEMENTATION CANDIDATE — NOT CLOSED. Ready for Technical Lead exact-head review only after the final gate;
no closure record is written before that review, the merge and the post-merge proof. L1-01 is NOT CLOSED.
**Branch:** `l1/deepseek-live-provider-bringup` from `main` @ `3d835ecc261168790c674409a355e36b7b30004f`.
**Executor:** Claude Code on the Founder Windows host (`E:\QANDEEL_COMPANY`, Node 24.19.0, npm 11.17.0), as the Founder
decided: Local Integration & Acceptance runs on the real repository, not from a Cloud clone.
**Decisions:** D-L1-01 … D-L1-08 in `docs/architecture/DECISION_LOG.md`.

L1-01 brings the Founder-selected DeepSeek-V4.1-Flash (`deepseek-flash`) into the Company through the EXISTING governed
Model Runtime. It is provider bring-up, not a redesign: no second LLM runtime, no second provider, no DeepSeek Pro
fallback, no provider tools, no voice, no APP-OPS transport, no social / hosting integration, no unlimited budget.

## 1. Start gate (repository truth)

| Check | Result |
|---|---|
| Working directory / repository | `E:\QANDEEL_COMPANY`, `allamqandeel/qandeel-company`, branch `main` |
| `HEAD` = `origin/main` | `3d835ecc261168790c674409a355e36b7b30004f` = expected |
| PR #16 | MERGED 2026-10-01T20:13:03Z; reviewed head `2e30a5408c8b8ae0c69bcc5d93e1b25c1ba3cdb3`; merge `3d835ec` |
| Run #103 (`36914622667`, PR head `2e30a54`) | SUCCESS, first attempt, 47 jobs (45 success, 2 skipped docs/integrity paths), zero failures |
| Run #104 (`36919952412`, push `3d835ec`) | SUCCESS (fast-integrity path) |
| Run #102 (`36907035166`, candidate `427f759`) | cancelled: Windows `c6-1of2` hit the 45-minute ceiling while passing (capacity defect, corrected in `2e30a54`) |
| Working tree | clean; `docs/C7D_CLOSURE_RECORD.md` absent on the baseline (as the brief expected) |

No drift; no `AUTHORITY CONFLICT`. Read before design: `CLAUDE.md`, `README.md`, the baseline, the implementation
authority rules, the implementation map, `BOUNDARIES.md`, the decision log, the C2 / C3 / C5 / C6 / C7-D reports and
closures, Stage 13 and Stage 14 in full, `providers.ts`, `routing.ts`, `economics.ts`, `model-runtime.ts`,
`provider-boundary.ts`, migration 0004, the governance store, the Founder action store, the communications store, the
context assembler and the Windows notes.

## 2. C7-D lifecycle closure sync (first commit)

`docs/C7D_CLOSURE_RECORD.md` from GitHub truth: PR #16; original candidate `427f759` whose run #102 was a Windows C6
shard capacity failure while mutations were passing; the permanent correction `2e30a54` (Windows C6 2 → 4 shards, no
coverage removed, no timeout raised); exact-head run #103 SUCCESS (47 jobs, zero failures); merge `3d835ec` (same tree
`8a34a7ec`); post-merge run #104 SUCCESS; **C7-D CLOSED / MERGED / CANONICAL, C7 overall CLOSED / MERGED / CANONICAL.**
Implementation map, README, baseline and boundaries synced; a lifecycle note appended to the C7-D report (narrative
unchanged); `0015_c7d_digital_presence.sql` frozen in the verifier by its exact hash (`1e77232f…`). No C7-D behaviour
changed.

## 3. Official DeepSeek research refresh (2026-10-05; `source → current fact → consequence`)

| Source (official) | Current fact | QANDEEL consequence |
|---|---|---|
| `api-docs.deepseek.com/quick_start/pricing` | Models `deepseek-flash` (= DeepSeek-V4.1-Flash) and `deepseek-v4-pro`; context 1M, max output 384K; legacy `deepseek-v4-flash` still accepted but retired and served by V4.1-Flash; USD per 1M tokens: cache miss $0.30 peak / $0.15 off-peak, cache hit $0.006 / $0.003, output $1.20 / $0.60; "Peak hours are 01:00–04:00 and 06:00–10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full." Off-peak = half of peak | Alias `deepseek-flash` only (the retired alias is refused at the adapter); conservative Company limits, never 1M / 384K; the versioned pricing basis `DEEPSEEK_FLASH_PRICE_CARD` + schedule (D-L1-04); peak + all-cache-miss reservation; actual settlement by band |
| `api-docs.deepseek.com/api/create-chat-completion` | `POST https://api.deepseek.com/chat/completions`, `Authorization: Bearer`; roles system / user / assistant / tool; `max_tokens` 1..393 216 (default 8K non-thinking, 64K thinking, 128K at max); `thinking: { type: enabled \| disabled, reasoning_effort: none \| low \| high \| max }`; `response_format` text / json_object; response `model`, `created`, `choices[].message.content`, `choices[].message.reasoning_content`, `finish_reason` stop / length / content_filter / tool_calls / insufficient_system_resource / aborted; usage `prompt_tokens`, `completion_tokens`, `prompt_cache_hit_tokens`, `prompt_cache_miss_tokens`, `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens` | Fixed origin + endpoint; `stream: false`; E1 → disabled, E2 / E3 / E4 → low / high / max; JSON mode for the one-JSON proposal contract; only `content` + `usage` read; finish reasons mapped (CONTENT_POLICY, CAPACITY, UNKNOWN, CONTRACT_VIOLATION); hit + miss must sum to the prompt |
| `api-docs.deepseek.com/guides/thinking_mode` | Thinking on by default at `high`; effort `low` / `high` / `max`; `reasoning_content` must be passed back only when `tools` are used (the Company never sends tools) | The adapter sets thinking explicitly per class and never reads the thinking field |
| `api-docs.deepseek.com/guides/json_mode` | `response_format: {type: json_object}`; the word "json" must appear in the prompt; set `max_tokens` reasonably; the API "may occasionally return empty content" | The stable prefix says "as JSON"; empty content is returned as the provider's answer and refused by the proposal layer (one evidence-based escalation), not a deployment hold |
| `api-docs.deepseek.com/quick_start/error_codes` | 400 Invalid Format, 401 Authentication Fails, 402 Insufficient Balance, 422 Invalid Parameters, 429 Rate Limit Reached, 500 Server Error, 503 Server Overloaded | 400 / 422 INVALID_REQUEST, 401 AUTH, 402 BILLING, 429 RATE_LIMITED, 500 TRANSIENT, 503 CAPACITY; anything else UNKNOWN |
| `api-docs.deepseek.com/api/list-models` | `GET /models` → `data[].id`, `name` ("Display name of the model"), `context_window`, `max_output_tokens`, `effort` | The identity check: `id = deepseek-flash` and `name = DeepSeek-V4.1-Flash` is MATCH, else DRIFT (D-L1-05) |
| `api-docs.deepseek.com/news/news260910`, `/updates` | DeepSeek-V4.1-Flash released 2026-09-10; new prices from 2026-09-10 04:00 UTC; `deepseek-v4-flash` retired and routed to V4.1-Flash; peak / off-peak introduced 2026-08-16 | Basis date recorded; pinned revision label `v4.1-flash-alias-2026-09-10` |
| State Council notice 2025-11-04 (2026 holidays; not a DeepSeek fact, recorded as the holiday basis) | 2026-01-01..03, 02-15..23, 04-04..06, 05-01..05, 06-19..21, 09-25..27, 10-01..07 | `PRC_PUBLIC_HOLIDAYS_2026` in the schedule; a later year is a new basis version |

Not stated by the docs (recorded as residuals, never assumed): whether `max_tokens` bounds thinking tokens (R-L1-01) and
whether the band is decided by request or completion time (R-L1-02; L1 settles at the settling transaction's clock,
seconds after completion).

## 4. G1 — Skills

| Skill | Used | Concrete effect |
|---|---|---|
| `claude-api` | Read for the trigger check, not applied | The provider is DeepSeek (OpenAI-compatible); the skill's Claude-specific facts do not apply. No Claude model was selected |
| `code-review` / `security-review` | Not invoked as skills | Their lenses were applied by hand across the boundary families (no bypass, no secret in state, no CoT, fail-closed egress, truthful accounting) and encoded as proofs, mutations and verifier rules |
| Document / artifact / deck / spreadsheet / morning / schedule / loop skills | Not applicable | No document deliverable outside the repository |
| `run` | Not needed | The surface and the smoke are driven by the harness scripts, not a dev server |
| Project skills | None installed (`.claude/` holds no project skills) | — |

## 5. Mechanism census (extend, never duplicate)

| Need | Existing canonical mechanism reused |
|---|---|
| The model call | `GovernedModelRuntime` (only caller of `generate`), the C2 provider boundary snapshot, routing, reservation / settlement / hold, P-07, circuit breaker, dispositions |
| Context | C3 Context Assembler (mandatory, minted, manifest-bound); a Founder-thread reply preamble gains the MESSAGE shape (D-L1-07) |
| Founder ↔ CEO | C5 `CommunicationStore.send` → reply Work Item → `c2.employee-task` → MESSAGE proposal → `txRecordMessage` (unchanged) |
| Catalog | `registerProvider` / `registerModel` / `registerDeployment` / `addPriceCard` / `setQualification` / `approveEgress` / `createRoutePolicy` / `createBudget` (unchanged signatures; the price card input gained the schedule) |
| Founder authority | the C5 session chokepoint and the governed confirmation (`FounderActionStore` preview → fingerprint → confirm) |
| Credentials | the `vault:<name>` reference already on `model_providers.credential_ref` (0004) |
| Egress | the C2 hard gates (D4 never external; D3 external closed; explicit per-deployment approval ≤ D2) |

Not found anywhere (therefore added): a real vault implementation, a real provider adapter, a time-banded / cached-input
billing basis, a model identity check, a provisioning profile and its Founder intent.

## 6. Architecture (simple language)

The Founder types the DeepSeek key once at a hidden prompt; Windows protects it for the Founder's user account and the
Company only ever holds the name `vault:deepseek-company`. When the CEO's governed run needs a model, the runtime
assembles the context, checks the grant, routes to a DeepSeek deployment (E1 or E2 for the pilot), reserves the
worst-case money, and only then hands the messages to the DeepSeek adapter. The adapter fetches the key from the vault
for that one call, sends exactly the allowlisted fields to the fixed DeepSeek address, and hands back only the answer
text and the token counts. The runtime settles what DeepSeek actually bills (cache hits, peak or off-peak), parses the
answer as one typed proposal, and the CEO's message reaches the Founder's thread. Nothing else of the provider's response
survives; nothing of the Company reaches the provider except the governed context.

## 7. Windows secure vault (`@qandeel-company/secret-vault`, D-L1-02)

- `vault:<name>` references; `SecretVault.use(ref, fn)` hands the value to the callback only; `InMemorySecretVault` for CI.
- `WindowsUserVault`: DPAPI `ProtectedData.Protect / Unprotect`, `CurrentUser`, fixed application entropy
  (`QANDEEL_COMPANY/secret-vault/v1`, domain separation), blob `{ format: QANDEEL_COMPANY_VAULT_DPAPI_V1, scope, protected,
  createdAt }` under `%LOCALAPPDATA%\QANDEEL_COMPANY\vault\<name>.dpapi.json` (atomic temp + rename); tampered / foreign
  blobs are refused (`VAULT_TAMPERED`), never read as a value; no plaintext file; outside every workspace, backup, artifact
  and checkout.
- The one reviewed process path: `execFile` of `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` with
  `-NoProfile -NonInteractive -NoLogo -EncodedCommand <fixed script>`, `shell: false`, `windowsHide`, bounded timeout and
  buffer; the payload (base64) travels on stdin only; the host's text never travels (codes only). ESLint and verifier
  (`l1-vault-protected`) admit exactly this module and forbid any network path in it.
- `qandeel-vault set <name>`: interactive raw-mode prompt without echo (Backspace edits, Ctrl-C aborts), refuses
  `--secret` / `--value` / `--key` / `--password` / `--token` / `--api-key` / a second positional argument before anything
  else (exit 2), refuses a piped stdin, overwrites only with `--replace`, prints only the reference and file path. `has`,
  `list`, `remove` never show a value.
- Proven on this host: the real DPAPI round trip (3.2 s through the PowerShell host), no plaintext or base64 plaintext
  in the file, a flipped byte refused, a foreign file refused, the CLI refusals, the default directory under LOCALAPPDATA
  and outside the checkout. On Ubuntu the vault fails closed (`VAULT_UNAVAILABLE`) and the same test proves that.

## 8. DeepSeek adapter (`@qandeel-company/model-providers`, D-L1-03)

- `DeepSeekHttpsTransport`: `fetch` of `https://api.deepseek.com` + path only, `redirect: 'error'`, `Accept` /
  `User-Agent` / `Authorization: Bearer` (this request only) / `Content-Type`; request ≤ 4 MiB, response ≤ 2 MiB (else
  `oversize`), non-JSON → `malformed` (raw text never leaves the transport); `assertDeepSeekEndpoint` before every fetch
  (`POST /chat/completions`, `GET /models` only); failures carry a phase only (BEFORE_SEND / AFTER_SEND / TIMEOUT).
- `DeepSeekProviderAdapter.generate`: `buildChatBody` — `model: deepseek-flash`, messages (system → system, user → user,
  Company `tool` results → user; the provider's tool protocol is never used), `max_tokens` = the enforced ceiling,
  `stream: false`, `thinking` from the reasoning class, `response_format: json_object`; exactly the six allowlisted fields
  (a leak of the `ProviderRequest` is a mutation the proofs catch). Credential: `vault.use('vault:deepseek-company', …)`
  per call; no entry → AUTH (operational hold), nothing sent.
- `parseChatResponse`: `oversize` / `malformed` / non-object / another `model` / unusable usage / inconsistent cache
  counts / non-string content / `tool_calls` → CONTRACT_VIOLATION (with usage when reported); `content_filter` →
  CONTENT_POLICY; `insufficient_system_resource` → CAPACITY; `aborted` → UNKNOWN; non-200 → the status map; the thinking
  / chain-of-thought field is never read (the verifier forbids its name in every `src` module). Usage: `prompt_tokens`,
  `completion_tokens` (reasoning tokens included — they are billed as output), `cachedInputTokens` = `prompt_cache_hit_tokens`
  (or `prompt_tokens_details.cached_tokens`), validated as a subset of input.
- No retry, no fallback, no loop inside the adapter (the Model Runtime owns them); `calls` counts chat calls for proofs.
- `checkIdentity` (GET /models → MATCH / DRIFT / MODEL_MISSING / UNREACHABLE / AUTH / BILLING / RATE_LIMITED /
  PROVIDER_ERROR / CONTRACT_VIOLATION / CREDENTIAL_UNAVAILABLE; public name and limits only) and `probe` (one tiny
  non-thinking JSON call; metering only) are the operator's qualification / connectivity checks; neither is `generate`.

## 9. Deployment profiles and E1–E4 mapping (D-L1-01, D-L1-06)

| Deployment | Class | Thinking | Context (Company-side) | Max output (Company-side) | Qualification | Egress |
|---|---|---|---|---|---|---|
| `deepseek-flash-e1` | E1 LIGHT | disabled | 65 536 | 4 096 | LIMITED_PRODUCTION | D2 |
| `deepseek-flash-e2` | E2 STANDARD | enabled, `low` | 131 072 | 16 384 | LIMITED_PRODUCTION | D2 |
| `deepseek-flash-e3` | E3 DEEP | enabled, `high` | 131 072 | 32 768 | LIMITED_PRODUCTION | D2 |
| `deepseek-flash-e4` | E4 EXTENDED | enabled, `max` | 131 072 | 65 536 | LIMITED_PRODUCTION | D2 |

One model identity (`deepseek-flash` = DeepSeek-V4.1-Flash), pinned revision label `v4.1-flash-alias-2026-09-10`; the
provider's absolute maxima (1M / 384K) are never exposed. Pilot task classes `founder.reply` and `founder.brief`; route
policies E1..E2, `allowLimitedProduction: true`, one retry per call, 4 calls per run, escalation depth 1 / 200 000
micro-USD. Employee identity never references the model (0004 unchanged).

## 10. Alias drift protection (D-L1-05)

- Adapter: identity check before the first call and after each TTL (1 h); DRIFT / MODEL_MISSING → `MODEL_DEPRECATED`
  (disposition: hold DEPLOYMENT, fallback allowed) — nothing is sent to an unqualified model (runtime proof).
- Every answer's `model` must still be the alias (CONTRACT_VIOLATION otherwise).
- Operator check `qandeel-founder provider-check --provider deepseek` records `model_identity_checks` (append-only,
  content-free); provisioning needs a MATCH ≤ 7 days old for the expected name; requalification is a Founder act and a
  new immutable deployment profile.

## 11. Data egress (unchanged, proven)

D0–D2 only through the approved external deployment; D3 external egress stays closed (router gate, reservation re-check,
egress approval refusal, 0004 triggers); D4 never leaves. The profile validator refuses an external profile above D2
(`EGRESS_DENIED`); the runtime proof shows D3 and D4 work never reaching the fake transport. DeepSeek receives only the
governed context: no secret, no App content, no transcript, no consumer Memory / Analysis, no D3 / D4.

## 12. Pricing and accounting (D-L1-04)

- `PriceCard` + `PriceSchedule` (off-peak rates, UTC windows `[60,240)` and `[360,600)`, weekdays Mon–Fri, 2026 PRC
  holidays, basis source + date); `billedCachedInputPerMTok` = $0.006 peak; base rates = peak cache-miss ($0.30 / $1.20);
  economic rates = peak billed (budgets charge the governed cost; a provider discount never lowers it).
- Reservation: `worstCase` = peak + every input token a cache miss + the configured max output (unchanged function).
- Settlement: `actualCost(card, { input, output, cached }, settlingClock)` → `billed_micros`, `cached_input_tokens`,
  `billing_band`; `economic_micros` flat; `price_card_version` keeps provenance; a price change is a new card version.
- Datastore (0016): `price_card_schedules` immutable and never above the card's peak rates (only METERED);
  `usage_records.cached_input_tokens ≤ input_tokens`; `model_identity_checks` append-only; the confirmation catalogue
  gains `PROVIDER_PROVISION`.
- Proofs: UTC band boundaries (01:00 in, 04:00 out, 06:00 in, 10:00 out), weekends, holidays, FLAT cards, ceil per
  component, reservation never below actual, economic ≥ billed, historical immutability, accounting invariants.
  No C2 rewrite: `txReserve`, budgets, routing and dispositions untouched.

## 13. Governed provisioning and the Founder surface (D-L1-06)

`GovernanceStore.provisionProviderProfile` (canonical APIs, one qualification step at a time, egress, route policies, the
first bounded Company cap; never re-provisions; fresh MATCH required). `PROVIDER_PROVISION` structured intent: preview
validates the profile code + digest against the host-registered profiles, the identity check, the cap (bounded, positive)
and the currency; the payload shows deployments, peak / off-peak rates, basis date, egress ceiling and the exact cap; the
confirm provisions inside the one transaction (the pre-check joins it). `SHOW_PROVIDERS` read intent ("show providers",
"اعرض المزودين"), `GET /api/providers`, a palette section with the provisioning form (cap in USD → micro-units). Host:
`qandeel-founder serve --provider deepseek` (real adapter + profile), `provider-check --provider deepseek [--probe]`.

## 14. Founder ↔ CEO path and the stable prefix (D-L1-07)

The C5 path already drives a live model step end to end (`send` → reply Work Item → `c2.employee-task` → model →
MESSAGE → thread). The one missing seam was the prompt: the preamble never told a real model the MESSAGE shape. The
preamble of a Founder-thread reply Work Item (processor input binds `founderThreadId`) now carries one extra line
(purpose / attention level / body in the Founder's language / `brief: null` / `contextRefs`). Every other Work Item
keeps its exact pre-L1 preamble (byte-bounded budgets; the C3 proofs are unchanged).

The first live run showed that a prompt is advice, not a gate: the model (E1, thinking disabled) answered with a
well-formed MESSAGE, saw it recorded, and still proposed a new MESSAGE on every turn until `MAX_CALLS_PER_RUN`. Under
**D-L1-09** the executor ends a thread-bound run (a Founder reply, a CEO brief) as COMPLETED the moment the fence
records its message (`reply.sent` / `brief.sent`, the message id in the evidence): one answer, one governed call, never
a second message or a RUN_LIMIT after a delivered reply. The runtime proof's fake model now never proposes FINAL, and
the mutation `l1-recorded-message-does-not-end-run` proves the gate is real.

## 15. Tests

| Suite | Marker | Tests |
|---|---|---|
| `secret-vault/test/l1-vault.test.ts` | `L1-PROOF: secret-vault` | 4 (real DPAPI round trip on Windows) |
| `model-providers/test/l1-deepseek.test.ts` | `L1-PROOF: deepseek-adapter` | 7 |
| `governance/test/l1-economics.test.ts` | `L1-PROOF: economics-bands` | 6 |
| `storage/test/l1-provider-pricing.test.ts` | `L1-PROOF: storage-pricing` | 4 |
| `runtime/test/l1/l1-runtime.test.ts` | `L1-PROOF: runtime-l1` | 5 (real runtime, real adapter, fake transport) |

26 new tests over the brief's families (§17): vault (no plaintext, DPAPI round trip, no secret argument, no echo /
no pipe, outside the workspace, fake vault in CI); request (fixed host / path, Bearer at the boundary only, the alias,
E1–E4, no tools, output bound); response (content + usage, cache consistency, thinking ignored, malformed → contract
violation, raw never leaks); errors (400 / 401 / 402 / 422 / 429 / 500 / 503, timeout after send, connection failure,
malformed JSON, oversized); accounting (worst-case reservation, truthful cache-hit / off-peak billing, UTC boundaries,
immutable basis, mismatch fails closed); egress (D3 / D4 refused); runtime (governed path, authorization and budget before
network, retry / fallback unchanged, CoT never persisted).

## 16. Mutations

`scripts/l1-mutation-check.mjs`: 25 mutations (vault 3, request boundary 6, the recorded-message gate 1, response
boundary 3, failures 3, alias drift 2, accounting 6, egress 1) — 25 / 25 caught locally (the first egress mutation was redundant with the C2
`EGRESS_NOT_APPROVED` gate and was replaced by the profile-level D3 / D4 refusal). CI: one shard per operating system
(the suite runs in about 4 minutes locally), counted by the quality gate.

## 17. Verifier

New rules: `l1-requires-c7d-closure`, `l1-not-claimed-closed`, `l1-proofs-present`, `l1-vault-protected`,
`l1-provider-boundary`, `l1-pricing-truthful`; `secret-vault` and `model-providers` allowlisted; the no-network rule
admits exactly the DeepSeek transport and the vault module; the L1 mutation ids pinned; 0015 frozen; the smoke harness
listed as a seam harness. Self-test proves every rule can fail and admits the legitimate states. **99 / 99.**

## 18. CI

Mutation matrix: `l1-1of1` on Windows and Ubuntu; `quality-gate` counts `l1`; the root `ci` script runs
`l1:mutation`. Windows shard runtimes of run #103 were inspected: every shard ≤ 35 minutes (slowest `r1-3of4` 34m27s on
that run against 21–22 minutes on runs #100 / #97 — runner variance, not a repeated breach; `c3-1of2` 28m44s). No shard
was rebalanced and the 45-minute ceiling was not raised; the L1 shard is small.

## 19. Focused validation (during implementation)

- L1 suites 4 + 7 + 6 + 4 + 5 = 26 / 26; mutations 25 / 25; verifier 99 / 99; ESLint `--max-warnings=0` clean.
- Full suites of the touched packages re-run after the kernel / storage / runtime changes (see the PR handoff for the
  final-gate numbers).

## 20. Final exact-head validation and the live results

The one final full local `npm ci` + `npm run ci`, the GitHub exact-head CI, the Founder's vault provisioning, the live
connectivity / identity result, the governed Model Runtime smoke and the Founder ↔ CEO live smoke are reported in the
PR handoff. Sections 21–22 are filled in once the Founder has stored the key and the live steps ran.

## 21. Live results (filled after the Founder stored `vault:deepseek-company`)

All results are content-free (identifiers, counts, codes, amounts); the credential value was never printed, logged or
stored anywhere but the DPAPI blob. Time: 2026-10-05, 14:18–14:30 UTC (a Monday; outside the published peak windows).

**Key entry.** The executor STOPPED and gave the Founder one secure local command (`qandeel-vault set deepseek-company`).
The first entry was refused by DeepSeek (401 → identity check result AUTH, recorded). A content-free shape check inside
a vault callback (length and booleans only) showed a 70-character value whose two halves were identical and whose
first half had the DeepSeek key shape: the key had been pasted twice at the hidden prompt. The Founder re-entered it
with `--replace`; the `set` command now prints `chars` (never the value) so a doubled paste is visible at once. The
first `provider-check` also tripped a Node handle assertion at exit (a forced exit while the vault's PowerShell child
and the HTTPS socket were still closing); the command and the smoke harness now set the exit status instead.

**Connectivity and model identity (`provider-check --provider deepseek --probe`).** Result MATCH: alias
`deepseek-flash` → observed public name `DeepSeek-V4.1-Flash`, observed context window 1,048,576, observed max output
393,216 (both above the Company's class ceilings, which stay the binding limits). Identity check `72050145-b330-…`
recorded in the disposable workspace. Probe: 43 prompt tokens, 5 completion tokens, 0 cache hits, 11 output characters,
peak worst-case reservation 59 micro-USD; the answer text was neither printed nor stored.

**Bounded live qualification (smoke harness, caps visible before the call).** Identity MATCH re-checked and recorded;
the profile provisioned through the canonical catalog APIs: four deployments E1–E4 at LIMITED_PRODUCTION, egress D2,
pricing basis `api-docs.deepseek.com/quick_start/pricing` dated 2026-10-05; caps Company $2.00, Department $2.00, CEO
$1.00, reply Work Item $0.50 (hard caps, no top-up).

**Governed Model Runtime live smoke (canonical path, no bypass).** First run (before D-L1-09): the full path worked —
C3 context assembled (2,509 → 3,135 bytes), `model.invoke` authorized, route E1 `deepseek-flash-e1`, worst-case
reservations 1,994–2,059 micro-USD, four live calls settled truthfully at OFF_PEAK with 512 cached prompt tokens on calls
2–4 (billed 440 / 483 / 569 / 386 micro-USD against economic 878 / 1,113 / 1,288 / 921) — but the model proposed a new
MESSAGE on every turn, the fence recorded four messages, and the fifth reservation was refused `RUN_LIMIT /
MAX_CALLS_PER_RUN`: the reply item FAILED after a delivered answer. Classification: Company integration defect (the
executor relied on the model to propose FINAL), fixed by D-L1-09. Second run (fresh sandbox, after the fix): one live
call — 647 prompt tokens (0 cached), 712 completion tokens, band OFF_PEAK, billed 526 micro-USD, economic 1,050,
reservation 1,955 micro-USD SETTLED, within bounds, run SUCCEEDED, Work Item COMPLETED, provider and all four
deployments ACTIVE, accounting invariants empty, Company budget spent 1,050 / reserved 0 of 2,000,000 micro-USD, health
HEALTHY. Durable state and logs: no credential, no `reasoning_content`, no `Bearer`, no reply text in logs.

## 22. Founder ↔ CEO live smoke or the exact next missing seam

**PASS — the canonical path supports it without a bypass.** The Founder's Arabic message (`send` → reply Work Item
`founder.reply`, D2, max output 1,024 → C3 Context Assembly → `model.invoke` authorization → Router Policy (E1,
LIMITED_PRODUCTION) → worst-case reservation → GovernedModelRuntime → DeepSeek ProviderAdapter → usage settlement →
MESSAGE proposal → the fence recorded it in the FOUNDER_CEO thread → the run ended `reply.sent`). The CEO's reply (an
Arabic introduction and seven structured questions about the project, the launch scope, readiness gaps, decision
rights, external commitments, success metrics and its own role, closing with the statement that it grants and approves
nothing) reached the canonical Founder surface in 5.5 s end to end. The smoke prints that reply as `founderVisibleReply`
(the Founder's own conversation); it is never in a log. Independently of the live result, the exact production seam
that L1-01 does NOT close is recorded:
**the first CEO of a real Company must be hired, trained and activated through production paths** (a Founder-created
hire → the Academy → the activation request approved through the authenticated surface). L1-01's smoke seeds that
identity through the test-only seam, exactly as every acceptance harness does, and adds no bypass; "the first production
CEO through the Academy and the Founder surface" is the next L1 task.

## 23. Residuals / deferred

- **R-L1-01** DeepSeek does not document whether `max_tokens` bounds thinking tokens. The Company's output ceiling is
  sent as `max_tokens` and completion tokens are checked against it: if a thinking deployment ever reports completion
  tokens above the ceiling, the existing contract rule holds the deployment (truthful, fail closed). The E1 pilot
  deployment runs without thinking; E2 is to be observed on the first thinking call.
- **R-L1-02** Whether the band is decided by request or completion time is undocumented; L1 bands at the settling
  transaction's clock (seconds after completion). A boundary-crossing call could differ by one band.
- **R-L1-03** The 2026 holiday list is part of the pricing basis; a 2027 basis is a new card version (not automatic).
- **R-L1-04** The first production CEO (hire → Academy → activation through the Founder surface) is the next L1 seam.
- **R-L1-05** `GET /models` is read on every identity check; the adapter re-checks hourly. A provider that keeps the
  public name while changing behaviour is not detectable by name (requalification stays a Company decision).
- **R-L1-06** The Founder surface's provisioning form is a minimal palette section; no dedicated settings page.
- **R-L1-07** The GitHub driver's credential source (R-C7D-01) is not wired to the new vault in this task (anti-scope:
  no social / hosting integration); the vault is ready for it.
- **R-L1-08** No budget period / monthly reset exists (C2 residual); the L1 caps are lifetime envelopes.

L1-01 is NOT CLOSED.
