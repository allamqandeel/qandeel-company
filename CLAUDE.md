# CLAUDE.md — instructions for coding agents

## Read first, in order
1. `README.md`
2. `docs/authority/COMPANY_CANONICAL_BASELINE.md` — the short summary
3. `docs/authority/company-architecture/README.md` — the index to the detailed canonical Stage
   0–17 authority
4. The imported canonical authority relevant to your work package, **in full**, including the later
   stages that bind over it
5. `docs/authority/IMPLEMENTATION_AUTHORITY_RULES.md`
6. `docs/architecture/IMPLEMENTATION_MAP.md`
7. `docs/architecture/BOUNDARIES.md`
8. Current `main`
9. The Task Contract you were given. It defines your scope and anti-scope.

## Rules
- **When detailed imported canonical authority exists for a subject, do not implement from the
  short C0 summary alone.**
- Never edit files under `docs/authority/company-architecture/*/`. They are hash-checked exact
  copies. Report contradictions instead, as `AUTHORITY CONFLICT — PRODUCT OWNER REVIEW REQUIRED`.
- Never assume a Product decision that is not in the authority documents or your Task Contract.
  Report the gap instead. The Stage 16 (Founder Command Center) source artifact is missing: do
  not reconstruct it.
- Privacy is absolute. `docs/authority/COMPANY_CANONICAL_BASELINE.md` §5 holds the exact wording,
  which governs:
  - **Rule A.** Operational telemetry is ALWAYS content-free.
  - **Rule B.** APP-OPS-01 itself provides no path by which Company Operations receives private
    user content.
  - **Rule C.** No routine or exceptional human review of private QANDEEL conversation content is
    authorized through Company Operations or safety-monitoring flows.
- QANDEEL COMPANY is not the QANDEEL App. Never import, reference or write the App repository.
- Preserve Windows compatibility: the product runs on the Founder's Windows host. Paths, line
  endings, file names (including Arabic) and process handling must work there.
- Smart App Control is enabled on that host: no native addons, no locally built executables, no
  dependencies that ship unsigned native binaries. Pure JavaScript on the signed Node 24 runtime.
- No secrets in the repository, prompts, artifacts, logs, test fixtures or memory.
- Never use `tar` for backups or packaging.
- Record material engineering decisions in `docs/architecture/DECISION_LOG.md`.
- New packages are real subsystems, never placeholders; add them to `ALLOWED_PACKAGES` in
  `scripts/verify-bootstrap.mjs` in the same change.

## C1 runtime invariants (preserve them; details in `docs/c1/`)
- `node:sqlite` is imported only by `packages/storage/src/sqlite/connection.ts`. Never export a
  connection or an "execute SQL" function from `@qandeel-company/storage`.
- Every mutation is one short synchronous `BEGIN IMMEDIATE` transaction. State, history, outbox event
  and audit row commit together. Never `await` inside a transaction.
- Released migrations are immutable: add a new numbered file and pin its SHA-256 in
  `RELEASED_MIGRATIONS`. Never edit an applied one.
- Every worker write presents its fence (job ID, run ID, worker ID, fencing token). Never add a write
  path that bypasses fencing.
- No hard deletes of durable history. No polling loops. No network code in runtime packages. No
  third-party runtime dependencies unless allowlisted with a reviewed reason.
- Logs, events and audit rows carry IDs, states and codes only, never payload content (Rule A).
- Approval-gated or R3/R4 work fails closed until the C2 approval engine exists.
- Only the Runtime Supervisor acquires executable work (D-C1-22). Claims, the supervisor lease and
  worker writes live behind `@qandeel-company/storage/runtime-authority`, which only
  `packages/runtime` may import. The supervisor fence is mandatory in every claim. Never add a claim
  to the ordinary storage API, and never expose the runtime's mutable `CompanyStore` (use the
  read-only `view`).
- `fs.watch` is only a wake hint (D-C1-23). Any new transaction that makes work actionable must
  advance the durable wake generation in the same transaction (the `queue_jobs` triggers do this
  for queue changes). Never add a queue-polling loop to compensate.

## Before your final response
- Run `npm ci` and `npm run ci`; all must pass. Do not claim a check passed unless it ran.
- Report the Skills you actually used and their concrete effect.
- Work on a branch and open a PR. **Never merge** unless your task explicitly authorizes it.
