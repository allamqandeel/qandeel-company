# G4-C2-ARCH-01 — Skill Need Classification: architecture decision and executive Task Contract (DRAFT, awaiting Founder approval)

Branch `p1/context-intel-01`, head `06c3f98` (D1 `2be1b68` is an ancestor). Uncommitted work kept as is (TU-1, SN-2 table, SN-2
guidelines). No paid call, no HO-2 opening, no PR, no LIVE access. Evidence: `E:\QANDEEL_D2\evidence\p1-context-intel-01\corr-01\`
(`WP0-architecture-review.md`, `measurements.log`, `ho2/HO-2-MANIFEST.md`).

## 1. Facts established from the code (not assumed)
| # | Fact | Where |
|---|---|---|
| F1 | Context Assembly is one synchronous storage transaction; the provider call is awaited only after it commits (assemble → commit → call → settle). No network inside a transaction. | `runtime/src/runtime.ts:1325-1329`, `runtime/src/c3/context-assembler.ts` |
| F2 | Every model call needs a context minted by the C3 assembler for that run; the reservation is bound to its manifest. | `runtime/src/c2/model-runtime.ts:136, 263-273` |
| F3 | A Founder reply makes no model call before its reply step: the only `invokeModel` call site is the reply loop; the send path is a pure storage transaction. **No existing call can be reused**: Skills must be in the context before the reply call, and the reply call cannot select its own Skills without loading all of them. | `runtime/src/c2/employee-task.ts:266`, `storage/src/communications.ts:223-265` |
| F4 | A reply Work Item allows **3** possibly-sent model calls (`CHAT_REPLY_MAX_MODEL_CALLS`), exactly the AUTO recovery chain E1 → E2 escalation → continuation. | `storage/src/communications.ts:76`, `governed-writes.ts:373-374` |
| F5 | The Founder's per-message level pins **every** reservation of the Work Item (above and below); AUTO cap is per Work Item. | `governed-writes.ts:363-369`, `reasoning-control.ts:46` |
| F6 | `model.invoke` is granted per task class; a new task class needs a new grant and new immutable deployments + route policy (provisioning). | `governed-writes.ts:250-260`, `model-providers/src/deepseek/pricing.ts` |
| F7 | The DeepSeek adapter already sends `response_format: json_object`; E1 is non-thinking. | `model-providers/src/deepseek/adapter.ts:67` |
| F8 | Existing primitives for ordering: targeted wake of a parked job (`wakeWorkItemJob`), `WAIT` with `until`, job priority. | `storage/src/governance-core.ts:367`, `queue.ts:231` |

Consequence of F4 + F5: a classification call **inside** the reply Work Item would take one of the three recovery calls and
would be forced to the Founder's pinned class (E3/E4 for a classification). It must run in its **own Work Item**.

## 2. Comparison (free simulation; blind independent labeller stands in for "a model reading SN-2"; VAL1–4 = 240 messages
untouched by TU-1; TASK_REQUIRED of the six Skills vs the independent author)
| | Recall | Precision | EN / MSA / EG | Skills loaded / msg | Extra calls / msg | Verdict |
|---|---|---|---|---|---|---|
| TS-1 (HO-1, real) | 0.730 | 0.426 | — | — | 0 | failed |
| TU-1 (unseen author) | 0.63–0.70 | 0.45–0.51 | 0.61 / 0.73 / 0.76 | — | 0 | does not generalize |
| **A** conservative (substantive → all SUPPORTING) | 0.126 | 0.604 | ≈0.13 each | 4.68 (8.2 KB) | 0 | fallback only |
| **B** model for every reply message | **0.957** | **0.873** | 0.962 / 0.973 / 0.934 | 2.55 (4.4 KB) | 1 | **recommended** |
| **C** TU-1 shape gate + model | 0.935 | 0.870 | 0.924 / 0.960 / 0.921 | ≈2.5 | 0.78 | rejected |

C detail: the best local uncertainty signal (TU-1 shape) still sends 78 % of messages to the model, keeps 36 of 84 no-Skill
messages on the model path, and drops 5 of 248 required Skills (3 of them INDIRECT asks, the hardest class); saving ≈ $0.3
per 1,000 messages. Inside substantive messages there is no calibrated local confidence (TU-1's own TASK_REQUIRED calls are
wrong about half the time). B's figures are a **ceiling** from Claude labellers; DeepSeek Flash is unmeasured.

## 3. Cost and latency (rates from the price card `DEEPSEEK_FLASH_PRICE_CARD`, basis 2026-10-05; token counts are estimates)
- Classification call (estimate): ≈ 3.5 K input tokens (≈ 2.5 K static SN-2 prompt + ≈ 1 K need cards + the message), ≈ 90
  output tokens. Governed economic cost (peak, cache-miss — what budgets charge): ≈ **$0.0012 / message ≈ $1.2 / 1,000**.
  Billed, if the static prefix hits the provider cache (assumption): ≈ $0.45 / 1,000 peak, ≈ $0.23 off-peak.
- B loads ≈ 3.8 KB fewer Skill bytes per reply than A (≈ 1.1 K tokens ≈ $0.33 / 1,000 economic): net B − A ≈ +$0.9 / 1,000.
- Worst case under the reservation policy (estimate until the prompt is frozen): input upper bound ≈ 19 K (UTF-8 bytes) ×
  $0.30/M + 256 × $1.20/M ≈ $0.006 per attempt; at most one unbilled retry → ≤ ≈ $0.012 held per message, settled to actual.
- Latency (estimate, unmeasured): +1–3 s before the reply (non-thinking E1, short output); hard bound 20 s, then fallback.
  The reply's own 10-minute run and its E1/E2/E3/E4 calls are untouched (separate Work Item).

## 4. Recommended design — B, "Skill Need Assessment" (SNA)
1. **Send** (`communications.ts`, same transaction as today): for a Founder reply whose Employee has ≥ 1 eligible Skill in
   the need table, create a small SNA Work Item (processor `SKILL_NEED_ASSESSMENT`, task class `founder.reply` — the grant,
   deployments, route policy and D2 egress the reply already uses; input pins E1, `maxModelCalls` 1, no escalation, own
   allocation ≤ $0.02 from the Employee's envelope, higher job priority), linked from the reply's input. No SNA when no
   declared Skill is eligible (zero cost for other Employees). TS-1 `taskSignals` is removed.
2. **Assembly** (C3, new narrow purpose `SKILL_NEED`): a release-pinned classifier preamble + the SN-2 instruction text +
   one need card per eligible declared Skill (code, name, version, SN-2 §3 criteria — never the certified instruction text)
   + the Founder's message. No history, knowledge, memory or Skill instructions. Manifest recorded as for any call.
3. **Call**: through `GovernedModelRuntime` unchanged in contract (authorize → route → reserve → call → settle), E1, JSON
   mode, max output 256, per-call timeout ≤ 15 s.
4. **Output** (governance): new proposal type `SKILL_NEED` — a closed JSON object, one entry per offered code, tier ∈
   {TASK_REQUIRED, SUPPORTING, NON_RELEVANT}. Any unknown code, missing code, duplicate, other value or extra text rejects the
   whole output (no partial acceptance). No free text is stored.
5. **Record** (fenced, content-free): `{ policy: 'SNC-1', promptSha256, guidelinesSha256 (SN-2), needCardsVersion,
   deploymentCode, reasoningClass, source: MODEL | FALLBACK, fallbackCode?, tiers }` on the SNA item; then
   `wakeWorkItemJob(reply, ['SKILL_NEED_PENDING'])` in the same transaction.
6. **Reply**: before its first model step, if the SNA is not terminal and the 20 s bound has not passed → `WAIT
   SKILL_NEED_PENDING until bound` (no slot held, zero tokens). Assembly reads the SNA tiers; eligibility, certification,
   conflicts, SHA-verified load, CP-1, 60K, TASK_REQUIRED protection — all unchanged. The manifest policy JSON names the
   SNA source and version.
7. **Fallback** (A, deterministic): SNA failed, timed out, unavailable, circuit open (never waits on a circuit), budget
   refused, invalid output, or bound passed → every eligible declared Skill SUPPORTING (dev/val loaded recall 1.0), recorded
   as `FALLBACK:<code>`. An uncertain SNA call (money held) follows the existing reconciliation rule on the SNA item only;
   the reply proceeds with the fallback.
8. **Generality**: need cards are keyed by Skill code (never by Employee); a new Skill joins by adding its card (governed doc
   + version). Undeclared Skills keep the legacy lexical path.

Never changed: E1–E4, AUTO ≤ E2, RD-1, certifications, grants, budgets, D1, C1/C3/CP-1/G4b, migrations (none expected; a
need must be proven), LIVE. The classifier decides need only: it never grants authority, capability or a Skill that is not
eligible.

## 5. Executive Task Contract (after approval)
**Scope**: C2 only, on `p1/context-intel-01`. **Anti-scope**: everything in "Never changed"; no tuning on VAL or HO-2.

| Phase | Work | Gate |
|---|---|---|
| P1 | SNA pipeline with a fake adapter: governance (prompt builder, `SKILL_NEED` grammar + validator), mind (need cards, fallback, `skillTier` from SNA tiers), storage (send creates SNA; `SKILL_NEED` assembly purpose; fenced record + wake; reply reads tiers), runtime (SNA processor, per-call timeout, reply WAIT/bound). Remove TS-1 / TU-1 from product code (evidence kept). | focused tests green; `npm run ci` |
| P2 | Paid measurement on DEVA + DEVB (240 calls) — prompt revisions on DEV only, at most 3, each logged with its SHA; latency p50/p95, invalid-output rate, run-to-run variance. | Founder-approved spend ceiling |
| P3 | Freeze prompt; measure VAL1–4 once (240 calls). If VAL misses the gate: stop and report (E2 classification is a separate Founder decision). | R ≥ 0.90, P ≥ 0.80, per-skill R ≥ 0.80, per-language R ≥ 0.85, gap ≤ 0.10 |
| P4 | Freeze at a recorded commit; commit `scripts/p1-ho2-evaluate.mjs`; verify HO-2 hashes; evaluate once (96 calls); aggregates only. On failure: stop, no tuning on HO-2. | HO-2 thresholds of G4-C2-CORR-01 |
| P5 | Regression (60K, 11,750, CP-1, DG-1n, pools, canonical truth, populated stores, Skill load + SHA, AUTO E2 8,192, reservations, privacy, Academy/Shadow/Benchmark); `npm ci` + `npm run ci`; D-P1-15 in DECISION_LOG; then PR + one FULL GitHub gate; Founder merge approval; unified LIVE install (D1 + G4) only with separate permission. | FULL green |

**Files expected to change**: `packages/governance/src/{skill-need-classifier.ts (new), proposals / parser, reasoning-demand.ts (TS-1 removed → main bytes), index.ts}`, remove `task-understanding.ts`;
`packages/mind/src/{skill-need.ts, context.ts (source tag only)}`; `packages/storage/src/{communications.ts, mind-writes.ts,
runtime-authority.ts (record + wake export), skill-need-records.ts (new)}`; `packages/runtime/src/{c2/skill-need-assessment.ts
(new), c2/employee-task.ts, c2/model-runtime.ts (per-call timeout cap), c2/types.ts, runtime.ts (processor registration)}`;
Command Center listing (hide SNA items from the conversation, show them in operations) — to verify; tests in each package;
`scripts/p1-ho2-evaluate.mjs` (new); `docs/P1_SKILL_NEED_GUIDELINES_SN2.md` (commit); `docs/architecture/DECISION_LOG.md`.

**To verify during P1 (read-only)**: the `model.invoke` grant for `founder.reply` has no `max_uses` that SNA calls would
consume (else Founder decision); Command Center shows no SNA item as a conversation turn.

## 6. Founder decisions requested
1. Approve **B** as the permanent C2 design with **A** as its fallback; reject C.
2. Approve the SNA placement under the existing `founder.reply` task class (no new grant / provisioning), or require a
   dedicated task class (then a new `model.invoke` grant per Employee and an additive provider profile at install).
3. Accept the recurring cost: ≈ $1.2 per 1,000 Founder messages (governed economic, estimate), ≤ ≈ $0.012 reserved per
   message, an SNA allocation ≤ $0.02 per message from the Employee's existing envelope, +1–3 s latency (estimate), 20 s
   bound then fallback.
4. Approve the paid measurement: expected ≈ $1–3 (DEV ≤ 4 × 240, VAL 240, HO-2 96 calls), ceiling **$5**.
5. Choose how the DeepSeek credential reaches the measurement harness (never in the repository, logs or prompts).
