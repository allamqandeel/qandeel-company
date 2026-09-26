# CLAUDE.md — instructions for coding agents

## Read first, in order
1. `README.md`
2. `docs/authority/COMPANY_CANONICAL_BASELINE.md`
3. `docs/authority/IMPLEMENTATION_AUTHORITY_RULES.md`
4. `docs/architecture/IMPLEMENTATION_MAP.md`
5. `docs/architecture/BOUNDARIES.md`

Then inspect current `main` and the task contract you were given. The task contract defines your
scope and anti-scope.

## Rules
- Never assume a Product decision that is not in the authority documents or your task contract.
  Report the gap instead.
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
