# L1-01 Closure Record

**Status: CLOSED / MERGED / CANONICAL**

L1-01 — DeepSeek V4.1 Flash live provider + Windows secure vault + first local Company bring-up (the first L1 Local
Integration & Acceptance package) — is closed. This record was written at the start of L1-02 (2026-10-06) from GitHub
truth, as the lifecycle sync the L1-02 brief requires before any behavioural work. It does not reopen L1-01, does not
change any L1-01 behaviour and does not rewrite the implementation narrative in `docs/L1_01_IMPLEMENTATION_REPORT.md`.

- Implementation: L1-01 (the Windows user-scoped DPAPI vault `@qandeel-company/secret-vault`, the DeepSeek adapter and
  the release-pinned DeepSeek V4.1 Flash profile `@qandeel-company/model-providers`, the versioned time-banded / cached-input
  pricing basis, alias identity checks, the structured `PROVIDER_PROVISION` Founder confirmation, the Founder-thread
  MESSAGE preamble and the D-L1-09 thread-bound run end), all through the EXISTING governed Model Runtime
- PR: #17 (`l1/deepseek-live-provider-bringup`, "L1-01: DeepSeek-V4.1-Flash live provider, Windows DPAPI vault, first
  local Company bring-up"), merged 2026-10-05T23:00:37Z (14 commits, 66 files)
- Final exact reviewed head: `80086dd59f80677f6fed5a1f1f37839d90c1057a`
- Corrections inside the PR after the first Technical Lead review, both before the reviewed head:
  - **D-L1-10 (product wire correction).** The first draft nested the reasoning effort inside `thinking`; DeepSeek's
    official shape is `thinking: { type: enabled | disabled }` plus the top-level `reasoning_effort: low | high | max`.
    Corrected in `a023a22`, proved live on the Founder host (an E2 probe accepted by the provider) and guarded by two
    wire-contract mutations (the nested and the unlisted effort)
  - **D-L1-11 (validation / proof portability, no product change).** Run #106 on `a023a22`: the Ubuntu L1 mutation
    shard let two Windows-only vault mutations survive (2 / 27) because on Ubuntu `set()` and the CLI's `set` fail closed
    at the platform gate before the Protect call and before the hidden prompt. Two portable proofs were added in
    `80086dd` (the Protect gate and the hidden-prompt gate observed on every platform); no mutation was weakened, skipped
    or marked Windows-only
- Exact-head CI: run #107 (`37376010079`, pull_request on `80086dd`) — **SUCCESS** on attempt 2: 49 jobs, 47
  succeeded, 2 `skipped` (the docs-only and fast-integrity paths that do not apply to a full run), zero failures; the
  full Windows + Ubuntu proof set (classify, static, tests, acceptance, sharded mutations c1–c7d, r1 and l1,
  `quality-gate`)
- **Run #107 attempt 1 was infrastructure-only, not a product failure.** The Windows `mutation (windows-latest, c1-c2)`
  job started 21:42:03Z and never reported a single step (it stalled at runner checkout / setup) until it was cancelled
  at 22:37:03Z; the quality gate therefore failed its parity check. No new commit was made: only that job was re-run on
  the same SHA (attempt 2, 22:46:02Z → 22:57:56Z, success) and the quality gate re-evaluated green. The 45-minute shard
  ceiling was not raised and no shard was rebalanced
- Merge commit on `main`: `11805a94182f9590f69fb977351acb11c56e4674` (parents `3d835ec` and `80086dd`)
- Tree identity: PR head tree = merged `main` tree = `45f6e31ae11215c615fa816f24e79472d66375a6` (verified with
  `git rev-parse <commit>^{tree}` at the L1-02 start); the merged tree is exactly the tree run #107 proved
- Post-merge CI: run #108 (`37385985686`, push on `11805a9`) — **SUCCESS** via the fast-integrity path (classify,
  `integrity` Windows + Ubuntu, `quality-gate`; the full matrix was skipped because the tree is the one #107 proved). It
  is not a second full-matrix proof
- Migration released with this closure: `0016_l1_provider_pricing_identity.sql` (`2fc84ac5…`), pinned in
  `RELEASED_MIGRATIONS`; 0001–0015 unchanged. 0016 joins the verifier's frozen set in the change after its release
  (L1-02, this record's commit)

BLOCKER / MAJOR at merge: none, after Technical Lead exact-head review of `80086dd`.

## Live evidence recorded by L1-01

As recorded in the implementation report §21–§22 (content-free): the Founder stored `vault:deepseek-company` through the
no-echo prompt; identity MATCH (`deepseek-flash` → DeepSeek-V4.1-Flash); the corrected E2 thinking wire shape accepted
live; a bounded governed Founder ↔ CEO round trip through C3 Context Assembly → `model.invoke` authorization → Router
Policy (E1) → worst-case reservation → GovernedModelRuntime → DeepSeek → truthful settlement → MESSAGE → the canonical
thread, with no credential, `Bearer` or thinking text in durable state or logs.

**What L1-01 did not close.** The CEO in that live smoke was created and activated through the test-only Founder seam
(`--conditions=qandeel-test`), in a disposable workspace. The first production CEO — Founder-authenticated hire → QANDEEL
Academy → Activation Request → Founder activation, in a permanent workspace — is residual R-L1-04 and is L1-02's scope.

## Residuals handed to later work

As recorded in the implementation report §23 (none is reopened here): R-L1-01 (whether `max_tokens` bounds thinking
tokens is undocumented), R-L1-02 (band decided by request or completion time is undocumented), R-L1-03 (the 2026 holiday
list is part of the pricing basis), R-L1-04 (the first production CEO — L1-02), R-L1-05 (a provider that keeps its public
name while changing behaviour is not detectable by name), R-L1-06 (the provisioning form is a minimal palette section),
R-L1-07 (the GitHub driver's credential source is not wired to the vault), R-L1-08 (no budget period / monthly reset).

## Lifecycle

- The implementation report's header still reads "IMPLEMENTATION CANDIDATE — NOT CLOSED"; that is history and is not
  rewritten (a lifecycle note was appended). This record is the canonical closure statement.
- Review evidence: `docs/L1_01_IMPLEMENTATION_REPORT.md`
- Next step: L1-02, First Production Company Activation — started 2026-10-06 from `main` @ `11805a9` on branch
  `l1/first-production-company-activation`. L1 as a whole stays IN PROGRESS.

No L1-02 functionality is claimed by this closure.
