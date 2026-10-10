# P1-PRODUCT-KNOWLEDGE-01 — Shared Product Knowledge Access + CEO Identity Rename

**Status:** implementation candidate on branch `p1/product-knowledge-01`. It is not merged, not installed and not
activated. Decision record: D-P1-06 in `docs/architecture/DECISION_LOG.md`.

## 1. Research, repo truth and anti-duplication census

**Company repository (`main` @ `294534f`, open branches checked).**

| Area | What exists | What was missing |
|---|---|---|
| C2 Tool Registry / Executor / grants | Founder-registered Tools; per-Employee grants, never inherited; the authority path (grant, risk, data class, budget, idempotency); the chat loop already executes `TOOL_REQUEST` | No Tool reads documentation; the model is never told which Tools it holds |
| C7-D GitHub adapter | A write-capable promotion adapter: App credentials, `contents: write`, export and merge; one fixed-host transport with a closed endpoint allowlist | No content-read endpoint; no anonymous read |
| C3 Company Knowledge / Context Assembly | Founder- or lesson-provenance knowledge; L1–L6 layers; neutralized L4–L6 data | No path for external documents, by design (provenance is Founder, lesson or canonical only) |
| C4 Employee identity | `employees` name columns plus `profile.displayName`; append-only Employee history (PROFILE kind) | No rename act |
| C5 Founder confirmation | Structured preview, then fingerprint, then confirm; an intent CHECK in the datastore | — |
| Unmerged work | Only `l1/l1-02-first-production-ceo-activation` is ahead of `main`: superseded Academy-answer commits, unrelated | No overlapping work |

**App repository (public, read-only, at `6a5fa42`, 2026-10-10).** README, Current State, Project Map, Product Roadmap
and AGENTS were read.
- The North Star is the Living Analysis Map.
- The world types are exactly MY_WORLD, SHARED_WORLD and PUBLIC_WORLD. Replay and Matching are capabilities, not worlds.
- HIM is part of the closed Engineering Foundation.
- Locator documents state they are outranked by the records they cite.
- The Roadmap still called PR #324 unmerged while `main` was its merge, so summaries lag `main`.

**Boundary.** The verifier forbids any Company file from naming the App repository. The App repository is therefore
Founder-registered data, never a constant in code or docs.

## 2. What was reused

| Need | Reused mechanism |
|---|---|
| The read capability | The C2 Tool Registry, the Tool Executor and its full authority path; the employee-task loop |
| Network | The one approved fixed-host GitHub transport and its closed allowlist (two GET entries added) |
| Who may read | `permission_grants`, one per Employee, Founder-only |
| Where the source lives | The C7-D digital target registry: Founder-registered, suspendable, audited |
| How evidence reaches the Employee | The recorded step result, then C3 L6 neutralized data, with the manifest and budget unchanged |
| Founder control | The C5 structured preview, fingerprint and confirm |
| Rename history | The `employees` row and the append-only Employee history (PROFILE) |

Nothing new was built: no runtime, tool system, knowledge base, vector store, index, watcher or sync.

## 3. The change

- **governance:** the product-knowledge constants, the closed source list and the two new Founder intents.
- **tool-drivers:** the read-only `ProductDocsDriver` and its deterministic fake. The transport omits Authorization
  when the bearer is empty. Two read endpoints were allowlisted.
- **mind:** release-pinned guidance, shown only to an Employee that holds the grant.
- **storage:**
  - the plan and execute steps of `PRODUCT_KNOWLEDGE_ACCESS`;
  - the plan and write steps of `EMPLOYEE_RENAME`;
  - the granted-Tools lines in the governance preamble, in production work only;
  - migration `0022`, which adds the two intents to the previews CHECK.
- **runtime:** `productSource()`, the resolver the host wires to the reader.
- **command-center:** the Founder host registers the reader (inert until granted). It also adds the two confirmation
  sentences.
- **command-center-ui:** the person sheet gains a "Rename" form under About, and "Grant / Revoke product knowledge"
  under Authority.

## 4. Proof against the acceptance criteria

| Scenario | Proof |
|---|---|
| A — product understanding | The granted CEO reads once, sees each feature's own lifecycle row with a status hint, and its reply cites `path@commit` (`runtime/test/p1/p1-product-knowledge.test.ts`, `tool-drivers/test/p1-product-docs.test.ts`) |
| B — current state | Every read is pinned to the commit `main` resolves to and carries the three newest commits. A stale "NOT MERGED" summary is shown next to the newer merge, and a new commit is read again |
| C — unknown | An unknown topic comes back `unmatched`, a missing document `missing`, and a suspended source `unavailable`. The reply says it does not know, and nothing fails |
| D — shared capability | A non-CEO Employee uses the same Tool and the same driver after its own grant; there is no Employee-specific code |
| E — security | No grant means no read: the authority path refuses before the reader runs. An injected "request candidate-export" is refused with no intent. `.env` is refused before any request. Revocation stops reads. All requests are anonymous GETs |
| F — CEO identity | The same ID, grants, budget, E1 profile, kernel, history prefix (byte-equal) and conversation. One dated PROFILE row is added. The next context says "Ahmed Zaki". A stale preview is refused |

The surface proof is `command-center/test/p1-product-knowledge-surface.test.ts`. It shows the sentences, the person
sheet re-read and the grant, and that granting reads nothing.

No proof made a network, DeepSeek or paid call.

## 5. Limits not achieved here

- **LIVE is not proven.** The behaviour is proven on deterministic fakes. A real conversation needs an approved
  install, the Founder's grant and the Founder's rename.
- **Anonymous rate limit.** GitHub allows 60 requests per hour per IP. A first read uses up to 6, and a repeat on the
  same commit uses 1. Past the limit the read reports `unavailable`.
- **One read per reply.** The chat bound (3 model calls) is unchanged, so a reply carries one evidence set of at most
  about 8 topics. A cited record can be read by path on the next message.
- **Status hints are conservative.** A label the reader cannot place stays UNKNOWN_VERIFY, and the cited record
  outranks the hint.
- **No cross-conversation memory of evidence.** Reuse is the per-commit in-memory cache only.
- **The CEO Constitution still names Salim Nasser.** The Task Contract forbids editing the Constitution. Updating its
  name line is a separate Founder documentation decision.

## 6. Cost and complexity

- **No standing cost.** Nothing runs in the background, and GitHub reads cost nothing.
- **Cost per product question.** One extra model call (the read turn, about the context size) plus a larger second
  prompt of about 500 tokens of evidence.
- **Other questions.** A question that needs no read is unchanged. An Employee without the grant sees an unchanged
  context.
- **Code.** About 1,000 lines of source and tests across 7 packages, plus one migration that recreates one table.

## 7. Activation needing separate Founder approval

1. Approve the merge, then an approved release install (`release-activate`) of the merged build.
2. In the Command Center, rename the CEO: the person sheet, then Rename, then Ahmed / Zaki / أحمد ذكي, then confirm.
3. Grant product knowledge on the CEO's person sheet, naming the App repository (`github:<owner>/<repository>`) the
   first time, then confirm.
4. Optionally, grant product knowledge to other Employees later, one confirmation each.
5. Optionally, amend CEO Constitution v1 §1 to the new name, as a docs decision.

## 8. Local validation (working tree, Windows)

`npm ci`, then `npm run ci`. The plan was FULL-classified, and 15 of 15 local preflight steps passed:
- build, typecheck, lint;
- verify-bootstrap: 529 files, 110 of 110 rules;
- the four self-tests;
- tests: command-center 74/74, command-center-ui 38/38, governance 121/121, mind 132/132, runtime 212/212,
  storage 557/557, tool-drivers 25/25.

The storage figure includes the new migration 0022 upgrade proof (`storage/test/p1-product-knowledge-migration.test.ts`)
and the appended `22` in the existing released-upgrade expectations. The FULL continuity proof (Windows + Ubuntu, every
mutation family) is the GitHub gate on this PR's head.

## 9. PR #32 review corrections

- **One action definition.** The read is defined once, as `PRODUCT_DOCS_ACTION_DEFINITION` in governance, with a D2
  ceiling and a D1 result. Both the driver and the registration reuse it. No authority widened.
- **Omitted is not unmatched.** Evidence dropped for the result limit is reported as `omitted`. A topic with no matching
  line anywhere is `unmatched`.
- **Focused local proof** (no FULL rerun):
  - tool-drivers `p1-product-docs`: 12 of 12;
  - runtime `p1-product-knowledge`: 4 of 4;
  - targeted eslint: clean;
  - verify-bootstrap: 110 of 110.
- **The Constitution's old name is a clarification only.** The operational identity kernel holds no name. Scenario F
  proves the rename keeps identity and memory.
