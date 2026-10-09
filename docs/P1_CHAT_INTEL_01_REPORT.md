# P1-CHAT-INTEL-01 — Dedicated Employee Chat and DeepSeek V4.1 Flash Reasoning Control

**Status:** IMPLEMENTATION CANDIDATE. The PR is open and awaits the Founder's instruction «ادمج». It is not merged and not
installed.

**Baseline:** `main` @ `b9a272ed87e9c457c1dd526b997733ccf888bfbf`.

**Decision:** D-P1-01 (`docs/architecture/DECISION_LOG.md`).

## 1. Repo truth and anti-duplication

| Need | Existing seam reused | New |
|---|---|---|
| Persistent conversation | C5 `communication_threads` / `communication_messages` (append-only) and `directThread` (one thread per Employee) | Paging read `messagesPage` |
| Reply execution | C2 `c2.employee-task` reply Work Item. It is funded from the Employee envelope, with a worst-case reservation and settlement. One MESSAGE ends the run (D-L1-09). | Fast-chat bounds in its processor input |
| Reply state | Work Item, queue job, run, usage records | `replyStates` projection |
| Context | C3 governed Context Assembly and the Context Manifest | One bounded, optional history candidate |
| Per-message level | D-L1-44 `work_item_reasoning_overrides` (durable, read at run begin, enforced by `txReserve`) | Written in the same transaction as the send |
| Persistent level | D-L1-44 `EMPLOYEE_REASONING_PROFILE` preview → fingerprint → confirm, REVIEW_DUE | Employee Intelligence UI over it |
| E3 / E4 | D-L1-06 governed provisioning through `PROVIDER_PROVISION` | Additive-profile mode (`extendsProvider`) |
| Router, privacy, budget, qualification gates | Unchanged | — |

There is no migration, no new table, no parallel datastore, no new router, budget or certification path, and no new
network code.

## 2. What the Founder gets

- **Talk opens the Chat.** The Chat is a dedicated screen over the company: the person's identity and state, the
  transcript, Employee Intelligence, and the composer. Tasks, Working On and work items stay on the profile, and no work
  card appears in the chat.
- **The same conversation every time.** It survives close, reopen, page refresh and restart, because the history is the
  durable thread. Older messages load on demand, and nothing is dropped.
- **Under each question, the real state of its reply.** The states are:
  - Queued;
  - Writing a reply (the only animated state);
  - Waiting for budget;
  - Waiting;
  - Blocked;
  - No reply — failed, with the reason;
  - Cancelled;
  - Replied.

  Each state shows the level used and the money, with spent and held amounts kept apart from the cap. Ended work is never
  shown as "thinking" and is never retried from the surface.
- **A level for the next message only.** The choices are Default, E1 (thinking off), E2 (low), E3 (high) and E4 (max).
  - A level the Employee's maximum or the conversation route does not allow is shown, explained, and linked to the
    governed path: the profile, or Model providers.
  - The choice resets after each send.
  - It never changes the Employee profile.
- **Notes.** "Note, no reply" sends a note without a reply. It makes no Work Item and spends nothing. It is the only mode
  for a non-ACTIVE Employee (a trainee).
- **Closing.** × (or Escape) closes the Chat and returns to the profile it was opened from, otherwise to the company. ×
  on the profile closes it to the company. Nothing stops and nothing is lost.
- **Drafts.** An unsent draft stays per conversation, across close, reopen and page refresh, for the browser session. A
  send that failed keeps the draft. A retry after a lost response never creates a duplicate, because the server replays by
  idempotency key.
- **Employee Intelligence on the profile.** It shows:
  - the model (from the qualified identity: DeepSeek V4.1 Flash);
  - the default and maximum levels;
  - the availability of each level for conversation;
  - calls, tokens and cost by level;
  - the envelope's cap, held and spent amounts.

  "Change default or maximum" opens the canonical governed preview, which names the certifications that become due for
  review.

## 3. Fast, low-cost default

- The default is the Employee's own default level. For Salim that is E1: thinking off, 1,024 output tokens, unchanged.
- The bounds of one reply are:
  - at most 3 model calls and 3 turns, normally 1 call, because the recorded MESSAGE ends the run;
  - an output bound by level: E1 1,024, E2 2,048, E3 4,096, E4 8,192;
  - conversation history capped at 12 turns and 4,800 bytes, inside the existing 24,000-byte context budget.
- The worst case is reserved before every call and settled at actual cost (D-L1-04). Nothing escalates on its own beyond
  the existing bounded technical step, which is capped by the Employee's maximum.
- Opening or reading the Chat spends nothing. No approval is needed per message within the existing envelope. R-D2-06 is
  unchanged: a reply is paid from the envelope by default, and that remains the Founder's governance review.

## 4. E3 / E4 on DeepSeek V4.1 Flash

`deepseek-v4-1-flash-reasoning` is an additive, release-pinned profile, offered on the host beside the existing profiles.
It adds:
- the deployments `deepseek-flash-e3-chat` (thinking high) and `deepseek-flash-e4-chat` (thinking max), for
  `founder.reply` only;
- the same model identity, pinned revision, price card, D2 egress ceiling and LIMITED_PRODUCTION target as E1 / E2;
- `founder.reply` route policy v2, with a maximum of E4 (v1 is kept as history).

It never re-provisions the provider, never touches an existing deployment or another route, and creates no budget. The
Founder reaches it only through `PROVIDER_PROVISION` → preview → confirm, under Model providers ("Preview: add E3 / E4").

**Founder steps to use E3 / E4 with Salim (not done here):**
1. Run `qandeel-founder provider-check --provider deepseek` for a fresh identity MATCH.
2. Confirm the additive profile preview.
3. Raise Salim's maximum through Employee Intelligence. The preview lists the certifications that become REVIEW_DUE.

## 5. Salim's missing replies (R-D2-05): diagnosis status

**LIVE evidence was not read.** The auto-mode classifier refused even a read-only copy of the LIVE database ("Production
Reads"). No historical data, balance or work was touched. Repository truth explains the observed symptom: the old surface
showed every unanswered Founder message as "working on a reply", whatever its reply's state, so a FAILED or BLOCKED reply
"thought" forever.

The exact historical cause comes from the content-free diagnosis. Run it while the Company is stopped, or on a restored
copy of a verified backup:

```
node scripts/p1-chat-reply-diagnosis.mjs --workspace E:\QANDEEL_COMPANY_DATA\LIVE
```

It prints, per reply:
- its status and reason code;
- the Work Item, job and run states with their attempts and failure / dead-letter / wait codes;
- the requested and answered levels;
- the money: cap, held, spent and billed;
- the held reservations;
- the Employee's levels and envelope.

It prints no message body. Once this build is installed, the same states appear in the Chat under each historical
message. Historical FAILED / BLOCKED / DEAD_LETTER work is never retried automatically, and a new message works as soon
as the underlying cause (budget, provider hold, access) is resolved through its governed path.

## 6. Proof

The FULL GitHub gate runs on the PR head. The local results:

| Check | Result |
|---|---|
| `runtime/test/p1/p1-chat-intel.test.ts` (real DeepSeek adapter, fake transport, LIVE-shaped provisioning) | 9 / 9 |
| Runtime suite (including the updated C5 method census) | 191 / 191 after the census update |
| Storage suite | 546 / 546 |
| Governance | 113 / 113 |
| Mind | 132 / 132 |
| Model-providers | 8 / 8 |
| Command-center-ui | 19 / 19 |
| Command-center surface proofs (chat API and existing thread) | pass |
| `c5:spike` with `spike-chat-screen` (real headless Edge, disposable fake-provider Company) | PASS, 6 consecutive runs after one harness race was fixed |
| `verify-bootstrap` | 110 / 110 rules |
| impact-map self-test | ok |
| eslint (whole repository) | 0 warnings |
| Full walkthrough (A–K) | Stops at C-goal-focus, identically on `main`'s UI (pre-existing, R-D2-01 family). F / G were moved to the Chat screen but are not reached. |

Wire evidence for each level, from the real adapter request body:

| Level | `thinking` | `reasoning_effort` | `max_tokens` |
|---|---|---|---|
| E1 | `disabled` | — | 1,024 |
| E2 | `enabled` | `low` | 2,048 |
| E3 | `enabled` | `high` | 4,096 |
| E4 | `enabled` | `max` | 8,192 |

Measured read path on a disposable Company: the newest page takes 0.05 ms, reply states 0.05 ms, and intelligence
0.08 ms per call (median of 200).

## 7. Remaining blockers and risks

- **LIVE diagnosis.** The diagnosis of Salim's historical reply needs the Founder to run the script, or to approve a
  read-only run.
- **No live E3 / E4 qualification call.** No live call was made, because it needs the vault key and a tiny authorized
  spend. The request contract and pricing are the adapter's (D-L1-10, D-L1-04). The pinned identity check still gates
  provisioning.
- **Thinking within the output bound (an assumption, to verify live).** The per-level output bounds assume that DeepSeek
  counts thinking tokens inside `max_tokens`. If the Flash model needs more thinking than the bound for a message, the
  reply comes back invalid or empty. It is then refused as invalid output (one bounded escalation, then FAILED) and shown
  truthfully. Tuning the bound is a later decision based on live evidence.
- **R-D2-06.** A reply is paid by default, as before. It remains the Founder's governance review.
- **Full-mode walkthrough.** C-goal-focus fails on `main` as well. It is tracked under R-D2-01, outside this task.
