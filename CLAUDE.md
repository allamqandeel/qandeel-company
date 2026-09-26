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
- Privacy is absolute (baseline §5):
  - operational telemetry is always content-free;
  - APP-OPS-01 provides no private-content path;
  - no human review of private QANDEEL conversation content.
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

## Before your final response
- Run `npm ci` and `npm run ci`; all must pass. Do not claim a check passed unless it ran.
- Report the Skills you actually used and their concrete effect.
- Work on a branch and open a PR. **Never merge** unless your task explicitly authorizes it.
