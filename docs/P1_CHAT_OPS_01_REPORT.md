# P1-CHAT-OPS-01 — CEO Reply Recovery and DeepSeek Flash E1–E4 Operational Readiness

**Status:** PARTIALLY VERIFIED. Three things need Founder approval: the backup diagnosis (B), the paid probes (C2) and the
install (D).

**Canonical main:** `ea7fc6d611993cd7c03e9aadbcb0ca1ec8bb2fda`. PR #27 is MERGED; its FULL gate was green on tree
`8025b2d3`, which is the same tree as main.

**Decision:** D-P1-02 (`docs/architecture/DECISION_LOG.md`).

**LIVE boundary.**
- No LIVE database was opened, copied, checkpointed or restored.
- Nothing was spent and no release was activated.
- The only LIVE files read were three small JSON / log files, each with a plain file read: the release pin, the host
  descriptor and the content-free host log (a copy of it already sat in the D2 evidence folder). None of them is the
  database.

## A. Baseline

| Layer | State | Evidence |
|---|---|---|
| Merged on GitHub | PR #27 merged as `ea7fc6d` | `gh pr view 27` |
| Built | Desktop bundle artifact `qandeel-company-desktop` (FULL run 37896149370, tree = main), expires 2026-11-08 | GitHub artifacts API |
| Installed on the laptop | **No.** The newest installed bundle is `1.0.0-0d242cd6b699`, built from `ce4b5a8` (D2-UX-01). None of the P1 symbols are in the installed release. | `%LOCALAPPDATA%\Programs\QANDEEL COMPANY\versions\…\qandeel-desktop-bundle.json`; search of the installed release |
| Activated for the Company | **No.** The pin is release `93126f30…` (D2-UX-01, activated 2026-10-08T21:57Z); its rollback is `7feca58f…` | `LIVE\runtime\production-release.json` (file read) |
| Running | **Yes.** Host pid 20880, started 2026-10-09T04:25Z on release 93126f30 | `founder-host.json` + process list |
| Provider and routes in the store | Academy profile E1/E2 only (D2 snapshots: `provisioningProfiles` = academy, flash). The additive E3/E4 profile is not provisioned, and could not be, because its code is not installed. | `founder-host.log` serve line |
| Salim's ceiling | E1 default / E2 maximum, per the L1-02 seed and the P1 design. Not re-read from LIVE. | Repository and DECISION_LOG |

**Safest evidence path.**
- **Content-free logs and existing snapshots first.** Done.
- **Then a verified backup restored into an isolated workspace by the canonical `restoreToIsolatedWorkspace`.** This runs
  directly on the backup directory, without opening the LIVE store. The CLI `restore-check` opens LIVE first to read the
  backup record, which can checkpoint the WAL (R-D2-03).
- **Then `scripts/p1-chat-reply-diagnosis.mjs` on that copy.** A verification copy opens with `migrationMode: verify`.

## B. Salim's missing reply

**Observed.** The Founder's only message to Salim got no reply. The D2 snapshot counts one communication message in
total.

**Durable evidence.** Content-free: the founder host log, D2 state snapshots 2026-10-08 22:10Z.

| Time (UTC, 2026-10-07) | Event |
|---|---|
| 11:03:19.353 | Founder message written; reply Work Item `4589b13f` created |
| 11:03:19 → 11:03:43 | attempt 1, 24 s, RETRYABLE_FAILURE |
| 11:03:44 → 11:03:55 | attempt 2, 11 s, RETRYABLE_FAILURE |
| 11:03:57.597 → .617 | attempt 3, **20 ms**, RETRYABLE_FAILURE → job DEAD_LETTER, Work Item **BLOCKED** |
| 11:03:57 → 11:08:53 | **97 CEO-brief Work Items**, each with 3 runs failing in milliseconds → DEAD_LETTER / BLOCKED → next brief |
| 11:08:56 → 11:09:05 | last brief, attempt 3: a real provider call (about 10 s) → PERMANENT_FAILURE / FAILED; the chain ends |
| 11:09:05.783 | last usage record in the Company; nothing has run since |

Budget at the snapshot:

| Budget | Cap | Spent | Reserved |
|---|---|---|---|
| Company | USD 0.59 | USD 0.553947 | 0 |
| Salim's envelope | USD 0.59 | USD 0.553947 | 0 |
| Salim's tokens | 1,000,000 | 910,390 | 0 |

**Established.**
1. **The reply ended BLOCKED after three retryable failures.** It never "thought" for days. The old UI hid this; PR #27
   now shows it.
2. **The provider calls returned answers that were classified as failures, not timeouts.** Attempts 1 and 2 lasted 24 s and
   11 s, well under the 120 s call timeout.
3. **An open circuit breaker caused the fast failures.** Attempt 3 and every brief run failed in milliseconds, with no
   network. The fast window ended exactly 5 minutes after attempt 2 (`CIRCUIT_OPEN_MS` = 5 min, `CIRCUIT_THRESHOLD` = 3).
   This is consistent with three consecutive circuit-counted failures opening the deployment circuit. The classes that
   count are TRANSIENT, TIMEOUT_AFTER_SEND, CAPACITY, CONTRACT_VIOLATION and UNKNOWN.
4. **The 97 brief Work Items are a genuine software defect, not the cause.** Every BLOCKED Work Item, including a brief,
   requested a new CEO brief. This amplified one failure into 97 BLOCKED items. It is fixed by D-P1-02 (this PR).

**Not established.** The exact failure class of the reply's provider answers, and therefore whether the cause is the
provider, the adapter contract or the output bound. It lives only in the store: `runs.failure_code`, the usage and
reservation rows, and the deployment `circuit_*` / hold columns.

**Approval gate B.** Run the content-free diagnosis on an isolated restore of verified backup
`b293e68d-61b7-4872-8382-fc0db5bd6fc6`:
- integrity `ok`;
- taken 2026-10-08T21:57Z;
- it contains the whole incident, because nothing has run since 2026-10-07 11:09Z.

The steps:
1. Run `verifyBackup` and `restoreToIsolatedWorkspace` from `LIVE\backups\b293e68d…`. This reads the backup files only; the
   LIVE store is never opened. The restore target is a new scratch directory, held permanently as RESTORE_CHECK_COPY.
2. Run `node scripts/p1-chat-reply-diagnosis.mjs --workspace <copy>`. It prints IDs, states, codes and money only.
3. Delete the scratch copy afterwards. It contains private conversation content, which is never printed.

**Remedy (all cases).**
- No automatic retry: historical FAILED / BLOCKED / DEAD_LETTER work stays as it is (R-D2-05).
- Install the PR #27 release (gate D) so the true states are visible, then send a **new** message.

Before that new message there are two blockers, both Founder decisions:
- **(a) Envelope headroom.** About USD 0.036 is left of USD 0.59. A reply reserves its worst case first. If the headroom is
  too small, the new reply shows "Waiting for budget"; raising the cap is the governed budget act.
- **(b) The cause in step B, if it is a contract or output-bound failure.** It must be fixed before a new message can
  succeed. The paid probe C2 tests this on the current API.

## C. DeepSeek V4.1 Flash E1–E4

### C1. Free verification

The official docs were read on 2026-10-09:
[thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/),
[create chat completion](https://api-docs.deepseek.com/api/create-chat-completion/),
[list models](https://api-docs.deepseek.com/api/list-models/),
[pricing](https://api-docs.deepseek.com/quick_start/pricing/).

| Item | Docs | Code | Verdict |
|---|---|---|---|
| Alias / identity | `deepseek-flash`; `/models` `name` "DeepSeek-V4.1-Flash" | `DEEPSEEK_MODEL_CODE` / expected public name the same | match |
| E1 | `thinking:{type:"disabled"}` (thinking is ON by default) | sends `disabled` explicitly | match |
| E2 / E3 / E4 | `thinking.enabled` + top-level `reasoning_effort` low / high / max | the same | match |
| Prices (USD / 1M) | peak: hit 0.006, miss 0.30, output 1.20; off-peak half | `DEEPSEEK_FLASH_PEAK/OFF_PEAK_RATES` the same | match |
| `max_tokens` | 1…393,216; default 8K without thinking, 64K with thinking, 128K at `max` | chat E1 1,024 / E2 2,048 / E3 4,096 / E4 8,192; probe 32 / 1,024 | **risk** |
| Reasoning in `max_tokens` | not stated; the 64K / 128K thinking defaults imply that it is included | assumed included | unverified |
| Reasoning billed as output | not stated ("total input and output tokens") | worst case reserves all output | conservative |
| `finish_reason` | stop, length, content_filter, tool_calls, insufficient_system_resource, aborted | `length` accepted as an answer; the others are classified | see below |
| JSON output with thinking | supported, no restriction stated; `length` may cut the JSON | every chat call is `json_object` | risk on `length` |

**Findings.**
- **Wire contract.** The identity, request shape and prices are correct against the current docs.
- **Output bound (unverified).** DeepSeek defaults thinking requests to 64K–128K output. Our E3 (4,096) and E4 (8,192)
  bounds are 16–32× smaller. If reasoning counts toward `max_tokens`, a high or max reply can end `length` with a cut or
  empty JSON. That is refused as invalid output and shown as Failed, never as a silent success. Only a real call settles
  it.
- **Probe metering gap.** The existing `--probe-class` prints usage and output length only. It omits `finish_reason`,
  `reasoning_tokens` and latency, and it thinks under a fixed 1,024-token ceiling.

### C2. Paid probe plan (needs explicit approval of the amount)

The probes use the existing `qandeel-founder provider-check --provider deepseek --probe --probe-class Ex` path, one call
per level, with no retries.

**Isolation.**
- **Workspace.** A **disposable** workspace in the scratch directory, never LIVE. `provider-check` records an identity row
  in the workspace it is given.
- **Content.** The probe prompt is the adapter's fixed probe; there is no Founder or Employee content.
- **Billing.** The probes are charged to the provider account only, never to a Company budget.
- **Credential.** The API key comes from the existing vault reference `deepseek-company`. It is never printed.

| Option | Calls | Output allowance | Worst-case cost (peak, USD) |
|---|---|---|---|
| **P-a: existing probe, unchanged** | 1 identity GET + 4 POST (E1–E4) | E1 32; E2 / E3 / E4 1,024 each | ≤ 0.004 |
| **P-b: probe at the real chat bounds** (needs a small probe change: allowance = chat bound, plus content-free `finishReason` / `reasoningTokens` / `latencyMs`) | 1 + 4 | E1 1,024; E2 2,048; E3 4,096; E4 8,192 | ≤ 0.019 |

The input cost is negligible: under 200 tokens per call, under USD 0.0003 in total. **The proposed hard ceiling to
authorize is USD 0.05.** Each call reports:
- identity: MATCH or not;
- accepted, or the failure class;
- `finish_reason`;
- prompt, completion and reasoning tokens;
- the answer present, as a character count only;
- latency;
- the computed cost.

### C3. Not run

C3 needs the approval of C2.

Current status of each level:

| Level | Implemented | Provisioned in LIVE | Qualified (identity + live call) | Live-tested | Usable by Salim now |
|---|---|---|---|---|---|
| E1 | yes | yes (Academy profile) | identity checks and E1 calls ran in L1-02 (368 usage records); the latest identity verdict was not re-read from LIVE | yes, at L1-02 | as soon as a reply can succeed (B) |
| E2 | yes | yes | wire shape tested only with the fake transport | **no** | after B, within his maximum E2 |
| E3 | yes (PR #27) | **no** (additive profile not installed / provisioned) | no | no | no |
| E4 | yes (PR #27) | **no** | no | no | no |

## D. Readiness path for the Founder

Every step goes through the canonical governed path, and nothing is done automatically.

1. **Install and activate the PR #27 release (approval gate D).** Use `desktop-local-install` with the bundle from run
   37896149370 (tree = main): its own signed `node.exe`, a pre-install backup, then the pin. The rollback stays at
   93126f30.
2. **Check the identity.** `qandeel-founder provider-check --provider deepseek` must report MATCH. This records an identity
   row: a system fact, no spend.
3. **Review the additive profile.** Model providers → "Preview: add E3 / E4" (`deepseek-v4-1-flash-reasoning`). The preview
   shows two new deployments for `founder.reply` only, route policy v2 (maximum E4), no new budget and no change to an
   existing deployment. **The Founder confirms it, or does not.**
4. **Set Salim's levels.** Profile → Employee Intelligence → "Change default or maximum". The preview names the
   certifications that become **REVIEW_DUE** on a permanent change. The Founder decides.
5. **Choose a level per message.** The chat's level for one message (Default, E1–E4) stays a one-task override. It never
   changes the profile, and it is refused above his maximum or the route.
6. **Controls are unchanged.** Budgets, egress (D2), certification and Founder authority are all untouched by these steps.
