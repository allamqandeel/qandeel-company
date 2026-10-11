# P1-CHAT-REFS-CORR-01: Founder chat reference format and safe reply recovery

Decision: D-P1-08 (`docs/architecture/DECISION_LOG.md`). Base: main `8f78f2e`. One corrective PR. Not merged and not
deployed; LIVE was not touched.

## 1. Root cause

**Established** from the content-free LIVE read model (the Founder chat's per-call observations):
- Work Item `aae70173`, pinned E2. Call 1 was valid but not final. Calls 2 and 3 were `MALFORMED / REFS_INVALID`, with
  `finish_reason=stop` and well under the 4096 allowance. The run ended `MODEL_OUTPUT_INVALID`.
- The same code appeared in 2 of 15 replies before the Product Knowledge grant (E1, rescued by escalation) and in every
  reply after it.
- The rule: MESSAGE `contextRefs` takes at most 8 entries of `^[a-z][a-z0-9_-]{0,31}:[A-Za-z0-9._:-]{1,95}$`, so no `/`,
  `@` or spaces. The reply shape shows only `"contextRefs":[]` and never states that grammar.

**Inference**, not confirmable because the raw output is never stored: the Product Knowledge guidance ("cite path + short
commit") led the model to put document paths in `contextRefs`.

## 2. Consumers of `contextRefs` (all inspected)

| Consumer | What it does | Authority? |
|---|---|---|
| `governance/src/proposals.ts` | parses and validates the grammar | none |
| `runtime/src/runtime.ts` `sendMessage` | passes the parsed list to the message fence | none |
| `storage/src/communications.ts` `txRecordMessage` / `insertMessage` | bounds each entry to ≤ 128 and the list to ≤ 8; persists `context_refs_json` | none |
| `storage/src/communications.ts` Founder `send` | the Founder's own refs are part of the send fingerprint (idempotency) | none; not the Employee path |
| `migrations/0009` `communication_messages.context_refs_json` | JSON array ≤ 1024 bytes; append-only (update trigger) | none |
| `storage/src/founder-records.ts` `mapMessage`, `MessageMeta` | read model; MessageMeta is the content-free shape (hence the grammar) | none |
| UI, API, reviews, evidence, routing, grants | never read MESSAGE refs | — |

REVIEW_DECISION `evidenceRefs` are a different field and keep their strict rule.

## 3. Why the recovery cannot bypass provenance or authority

- **Nothing is granted.** No consumer resolves, verifies, grants or cites through MESSAGE refs. Dropping an invalid one
  changes no authority, evidence obligation, route or budget.
- **Nothing is fabricated.** Only grammar-valid references are kept, in their order. The body, purpose, level and brief are
  the output's own; nothing is rewritten or invented.
- **The scope is narrow.**
  - The parser's proposal is unchanged for every caller (MALFORMED / REFS_INVALID).
  - The recovery is offered only when every other MESSAGE field passed and the list is bounded.
  - Only a reply to one Founder message uses it; the submitter binds `founderThreadId` and `founderMessageId`, never the
    model.
  - A CEO brief, answer-only work, a review and every other proposal type are unchanged.
- **The fence re-checks the claim.**
  - It accepts only a Founder reply, a count of 1..8 within the bound, and kept references in the grammar. Anything else is
    `INVALID_ARGS`.
  - Thread binding, body bounds, the secret scan and per-body idempotency run as before.
- **Hostile input stays refused.** A non-list, more than 8 entries, a non-string, or an empty or oversized entry offers no
  recovery and stays an invalid output. Nothing is truncated into metadata.
- **Content-free.** Discarded references are never stored, logged or shown. One audit row,
  `communication.message_refs_discarded` / `CHAT_REFS_DISCARDED`, carries `{ messageId, runId, discarded, kept }` and is
  written in the message's own transaction. The call observation still records the raw output truthfully.

## 4. Changes

- **Layer A**
  - `storage/src/mind-writes.ts`: the reply shape states the grammar (at most 8 `kind:id`, an example, otherwise `[]`;
    never a path, URL, GitHub address, commit or prose; cite in the body).
  - `mind/src/product-knowledge.ts`: cite document path + short commit in the reply body; never put a path in
    `contextRefs`; never invent a structured reference. The four-state distinction is unchanged.
- **Layer B**
  - `governance/src/proposals.ts`: `refsRecovery` and a shared `isStructuredRef`.
  - `runtime/src/c2/model-runtime.ts`, `types.ts`: the recovery is carried on the OK outcome.
  - `runtime/src/c2/employee-task.ts`: used only for a Founder reply.
  - `runtime/src/runtime.ts`: passes the count.
  - `storage/src/communications.ts`: the fence's re-check and the content-free row.

No schema, migration, routing, E1–E4, grant, review or evidence rule changed.

## 5. Regression tests (fake provider, disposable workspaces, no paid call)

| Scenario | Proof |
|---|---|
| Valid MESSAGE with valid refs; `contextRefs:[]` | governance `p1-chat-refs` 1 |
| Product path in `contextRefs` | governance 2; runtime refs 1 |
| Path + commit in the body is preserved | governance 2; runtime refs 1; storage 1 |
| Invalid JSON or invalid body; any other defect first | governance 4 |
| Hostile or oversized reference payload | governance 3; runtime refs 2 |
| REVIEW_DECISION malformed evidence refs | governance 5 |
| Other outputs: a CEO brief is never recovered | runtime refs 4; storage 3 |
| Secret material | storage 2; runtime refs 3 |
| Retry and Founder-pinned E2 unchanged (same-class retry, call bound, no escalation) | runtime refs 2 |
| Successful recovery: exactly one reply, one call, no retry spent | runtime refs 1 |
| Both instructions reach the granted CEO's context | runtime `p1-product-knowledge` |
| A fence claim it cannot verify (count, bound, kept path, a brief) | storage 2, 3 |

## 6. Residual risk

- The model may still break another closed rule (for example `BODY_TOO_LONG`). Those keep their existing handling.
- A reference list that is not a list, too long, or holds non-string entries still fails as before (by design).
- **Future, not in scope:** retry feedback. A same-class retry is not told which closed rule the previous output broke.
