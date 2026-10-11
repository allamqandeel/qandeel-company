# P1-CEO-QUALITY-CORR-01: CEO communication, product knowledge and chat reliability

Decision: D-P1-09 (`docs/architecture/DECISION_LOG.md`). Base: main `c35ce57`. One corrective PR: not merged, not
installed. No change was made to LIVE and no paid call was made. The LIVE evidence below is the content-free read model
(IDs, codes, counts, amounts), read with a read-only connection. No conversation text was read into this report.

## Results

| Part | Result | Root cause (established) |
|---|---|---|
| A: E4 output reliability | FIXED for the timeout; a reply is not guaranteed (deterministic proof; LIVE behaviour needs a separately approved test) | Thinking used the whole E4 allowance (16,384 of 16,384). The one continuation (32,768) was cut by the fixed 120 s call timeout: E4 runs at 151–177 tokens/s, so 120 s covers about 18k tokens. |
| B: product knowledge | FIXED | The documents write `MY_WORLD` and "Personal World", never "My World". A one-name query split into words. The implementation table was read through its *Decided* column. Runtime and user-facing code shared one status. Census lines carried no history mark. |
| C: CEO Arabic | FIXED as a prompt rule (it cannot guarantee every future sentence) | The conversation guidance had no rule for Arabic register, honorifics, literal translation, jargon, or fact versus hypothesis. |
| D: composer length | FIXED | `maxlength=4000` on the textarea let the browser cut a long paste silently. |

## A: what happened on LIVE (Work Item `d92356d3`)

| Call | Class / kind | Allowance | Result | Money |
|---|---|---|---|---|
| 1 | E4 PRIMARY (AUTO, RD-1 VERY_HIGH / VERY_HIGH / CLEAR) | 16,384 | `length`; reasoning 16,384, so the answer never started | billed 10,565 µUSD (charge 21,128) |
| 2 | E4 RETRY (continuation) | 32,768 | `TIMEOUT_AFTER_SEND` at 120.0 s | 46,229 µUSD **held** (`RECONCILIATION_REQUIRED`), not spent |
| run 2 | | | The only E4 deployment was excluded for this Work Item (it may have billed), so the continuation could not grow: `MODEL_OUTPUT_TRUNCATED`, with no further call | — |

- The held amount is visible in Attention. The Founder's existing reconciliation act settles or releases it.
- The 4,000-character body is not the cause. Successful E4 replies used 700–1,450 tokens of body and 3.4k–15.0k tokens
  of thinking.

**Fix.** A call's timeout grows with its allowance: `max(base, base × tokens / 15,000)`, 8 ms per token at the default.
- E1–E3 keep 120 s. E4 gets 131 s, and the 32,768 continuation gets 262 s (under the 300 s `fetch` header timeout).
- Three calls fit the 10-minute run.
- **Unchanged:** allowances, the one same-class continuation, the call bound, reservations, AUTO's E4 and the Founder's
  pinned E4, and the refusal of a truncated output.

**What this fixes, and what it does not.** It fixes the timeout: the continuation now has time to use its 32,768
allowance. It does not guarantee a reply.
- Thinking can still use all 16,384 tokens of the first E4 call. That call is still charged, and the continuation runs.
- If the continuation also runs out (or outlives even its scaled timeout), the reply still ends `MODEL_OUTPUT_TRUNCATED`
  with no partial message. A timed-out call is held for reconciliation.

**Bounded check of the timeout** (Founder review of PR #35). No code change was needed:
- **The allowance that reaches a call is at most 32,768 in the shipped product.**
  - Employee Work Item input is validated at ≤ 32,768 (`employee-task.ts`, `maxOutputTokens` and
    `maxOutputTokensByClass`).
  - A continuation is capped by `OUTPUT_CONTINUATION_MAX_TOKENS` = 32,768.
  - Academy limits are validated at ≤ 8,192 (`academy-package.ts`).
  - `founder.brief` and the Academy routes are capped at E2.
  - The release's only governed processor is `employeeTaskProcessor` (`command-center/src/surface.ts`). The runtime CLI
    registers deterministic processors only. The 120 s base is never overridden outside tests.
- **Upper bounds:**
  - **Per call:** 262,144 ms, below the platform `fetch` 300 s header timeout.
  - **Per Founder reply** (`CHAT_REPLY_MAX_MODEL_CALLS` = 3, at most one continuation): 131 + 131 + 262 = 524 s, or
    with a product-docs read, 131 + 60 (tool timeout) + 131 + 262 = 584 s. Both are below the 600 s run limit.
  - **Every other task class:** at most 131 s per call (a continuation of ≤ 8,192), against 120 s before.

**Founder decisions (review of PR #35):** E4's first allowance stays 16,384. No paid LIVE test now. No merge or install
before final approval.

## B: the product documentation reader

- `_` joins words. A closed table of equivalents covers the App's three world types and their Arabic names (my world /
  personal world / العالم الشخصي, shared world / العالم المشترك, public world / العالم العام). "عالمي" is excluded
  because it also means "global".
- Rows of the "Decided | In production code today | Still open" table show what production code implements today and
  what is still open.
  - Their status is `SURFACE_IMPLEMENTED` (the client), `RUNTIME_MERGED` (backend or runtime only) or
    `APPROVED_NOT_IMPLEMENTED` (nothing in production).
- A lifecycle row of a merged runtime, foundation or backend is `RUNTIME_MERGED`. Launch readiness is a separate hint
  (`NOT_LAUNCH_READY` / `NOT_DEPLOYED`), taken only from the row's own words.
- Census or "at the time" lines are marked `historical`, and a current line is preferred. `next` names the record that
  would settle an open topic. A real gap stays `unmatched`.
- Checked locally (not committed) against the App's real locator documents at `20e33ae`:
  - "My World" and «العالم الشخصي» → the Personal World implementation row (`SURFACE_IMPLEMENTED`), with its still-open
    items;
  - Replay → `RUNTIME_MERGED` + `NOT_LAUNCH_READY`;
  - Shared World → its implementation row.
- **Access unchanged:** anonymous GitHub read, exact commit, the closed source list, the grant, the result bound.

## C: language rule, with examples for review (synthetic)

`CEO_LANGUAGE_GUIDANCE` follows the conversation guidance on the direct Founder ↔ CEO turn only. The identity kernel
and the Constitution are unchanged byte for byte (pinned SHA-256). No profile, certification or Academy item changes.

| Avoid | Prefer |
|---|---|
| «يا فندم، بخصوص سؤال حضرتك يا فندم…» (in every reply) | «بالنسبة لسؤالك عن رؤساء الأقسام: …» |
| «دعنا نأخذ خطوة للوراء وننظر إلى الصورة الكبيرة» (word for word from English) | «خلّينا نبص على الموضوع من بعيد شوية» |
| «سنقوم بعمل تحسين الـ funnel الخاص بالـ onboarding» | «هنحسّن خطوات تسجيل المستخدم الجديد (اللي بنسميها onboarding)» |
| «السوق السعودي سيحقق 40٪ من الإيراد» (an estimate stated as fact) | «تقديري — وده فرض محتاج نختبره — إن السعودية ممكن تبقى أكبر سوق، والدليل الوحيد عندي لحد دلوقتي هو …» |

A report or formal document requested by the Founder is written in professional Modern Standard Arabic.

## D: composer

- No `maxlength`. A count under the composer uses the server's measure (the trimmed UTF-16 length). It warns from
  3,600; over 4,000 it says by how much and that nothing was cut.
- A paste that goes over the limit is announced. Send is disabled.
- An over-limit draft is never sent: no ticket and no key are made, and the whole text stays with its reason. The reason
  clears once the text fits. The server limit stays 4,000.

## Files

- `runtime/src/c2/model-runtime.ts`: `modelCallTimeoutMs`.
- `tool-drivers/src/github/product-docs.ts`: equivalents, layers, launch, history, next.
- `governance/src/product-knowledge.ts`: two status values and the launch hint type.
- `mind/src/product-knowledge.ts`: guidance.
- `storage/src/mind-writes.ts`: `CEO_LANGUAGE_GUIDANCE`.
- `command-center-ui/src/model/chat-send.ts`, `src/app/chat.ts`, `public/styles.css`.
- Tests in each package, and the docs.
- No migration, dependency, route policy, budget, grant or profile change.

## A limited LIVE test later (not now: the Founder deferred paid LIVE tests; needs new approval)

Three messages to Ahmed:
1. A strategic question under AUTO, expected at E4 (the A path).
2. "What is the state of My World?" (B).
3. One short everyday Arabic message (C).

- **Worst case:** two E4 calls, about USD 0.031 billed and USD 0.062 governed charge, plus about USD 0.01 for the other
  two.
- **Proposed cap:** USD 0.10 governed charge in total, including any retry.

## Decision gate (Founder kept 16,384 for now, review of PR #35)

- E4's first allowance stays 16,384. Raising it (for example to 32,768) would avoid a wasted first call when E4 thinks
  past it (2 of 7 LIVE E4 primaries did). The cost is a larger worst-case reservation per E4 call; billing would still
  follow actual tokens.
- **Residual:** after a timed-out continuation, the resumed run ends `MODEL_OUTPUT_TRUNCATED` because its only E4
  deployment is excluded for that Work Item. The end is honest (no complete output, no further call), but the code
  names the outcome rather than the exclusion.
