# D1 / D2 Closure Record — QANDEEL COMPANY Desktop v1

**Status: D1 CLOSED / MERGED / CANONICAL · D2 FOUNDER ACCEPTED / CLOSED (effective when this documentation PR merges)**

D1 — Desktop v1 Productization Mega Stage — and D2 — Founder Laptop Acceptance — are closed. QANDEEL COMPANY Desktop v1
is installed on the Founder's Windows laptop, ran READY at its last verification, and was personally reviewed and
accepted by the Founder on 2026-10-09. This record was written at D2-CLOSE-01 (2026-10-09) from GitHub truth and the
executor-reported acceptance evidence. It does not reopen D1 or D2, changes no behaviour, and does not rewrite the
decision history in `docs/architecture/DECISION_LOG.md` (D-D1-01 … D-D1-08, D-D2-01, D-D2-02).

## D1 — Desktop v1 Productization Mega Stage

- Scope: the Founder-local Desktop bundle (private pinned, officially signed Node 24 runtime; `desktop-local-install`;
  Windows "Apps" entry), branded shortcuts, update / rollback / repair / uninstall over the canonical OPS activation;
  `QANDEEL-COMPANY-Setup.exe` an optional ENGINEERING installer; commercial signing deferred to external distribution
  (D-D1-01 … D-D1-08; `packaging/windows/README.md`).
- PR: #23 (`d1/desktop-v1-productization`), merged 2026-10-08T05:41:23Z.
- Exact head `e7a77af9809bee9bd08d6d572b3864fa838a4ce2`; merge commit `413b3bd62fee784f7e299262cf008005063f1641`; tree
  `b03f2a29…` identical for both.
- CI: exact-head pull_request run #125 (`37728609624`) success; post-merge push run #126 (`37733637835`) success.

## D2 — Founder Laptop Acceptance

| Sub-stage | PR | Exact head | Merge commit | Tree | Exact-head CI | Post-merge CI |
|---|---|---|---|---|---|---|
| D2-CTRL-01 — lifecycle control inside the Command Center window (D-D2-01) | #24, merged 2026-10-08T10:58:08Z | `065b472d77dd478003f88783f8df5d9d38af937b` | `72b5d622c6955a39b2acc23e92d3e85d33d167bb` | `b308cc1d…` (identical) | run #128 `37758924138` success | run #129 `37766967027` success |
| D2-UX-01 — Academy overview, Meeting Room notice, person-sheet actions, explicit budget entry, dismissible activation, QANDEEL window icon (D-D2-02) | #25, merged 2026-10-08T16:46:07Z | `ce4b5a8d4547111f782eacbd626b4d4c57c7d04a` | `0c320193fde61546a8bd4cb6597ef2492748bff4` | `6574ff76…` (identical; also the run's `tested-tree` record, mode full) | run #131 `37798109760` FULL, success (60 checks: 56 passed, 4 skipped, 0 failed) | run #132 `37811375167` success |

### Accepted installation (executor-reported, 2026-10-08 UTC; D2-ACCEPT-01)

The facts below were reported by the installing agent from the Founder's machine. They were not independently
re-verified for this record, except the GitHub facts above.

- Artifact `qandeel-company-desktop` from FULL run `37798109760`: zip SHA-256 equal to the GitHub digest; bundle
  `1.0.0-0d242cd6b699`, class FOUNDER-RC, source `ce4b5a8d…` (clean), Node 24.19.0 Authenticode Valid;
  `npm run desktop:verify` ok. The unsigned ENGINEERING Setup.exe was not used.
- Installed by the canonical `desktop-local-install` after the Founder approved the command at the permission prompt:
  outcome `INSTALLED`, health `READY`, shortcuts and the "Apps" entry re-established.
- Installed LIVE release `93126f30c7902211…`; rollback release (pin `previous`) `7feca58f1c9c4d4b…`, release and
  previous application version kept; new verified backup `b293e68d…` (integrity ok).
- Business data preserved: before/after content-free comparison identical (employees, Work Items, runs, queue, budgets,
  grants, Academy, skills, activation, usage, messages, schema). Only lifecycle audit rows, Founder sessions and the
  backup were added. No paid model call and no message were initiated by the acceptance checks.
- Last verified health: READY on 2026-10-08T22:11Z UTC (one host, release `93126f30…`).

### Founder acceptance (2026-10-09)

| Area | Founder decision |
|---|---|
| Windows application and taskbar identity (QANDEEL icon on the shortcut, title bar and taskbar) | ACCEPTED |
| Employee profile (Talk / Budget at the top, About and Skills before Work, recorded facts only) | ACCEPTED |
| Academy (read-only overview) | ACCEPTED |
| Meeting Room entry (honest "not available yet" notice) | ACCEPTED |
| Activation panel dismissal (×, Esc, outside click) | ACCEPTED |
| Desktop Stop / Start / Restart | ACCEPTED |
| D2 Founder Laptop Acceptance | **APPROVED** — personally reviewed on the installed interface |

The machine-local evidence (screenshots, content-free state snapshots, install output) stays on the Founder's machine
under `E:\QANDEEL_D2\evidence\ux-01-install\` and is not committed: it is private operating evidence.

## Carry-forward residuals (non-blocking; they do not reopen D2 and are not resolved by this closure)

| # | Residual | Proposed owner | Note |
|---|---|---|---|
| R-D2-01 | The legacy C5 full-mode Visual Proof selectors still target the Talk button's old position (moved by D2-UX-01) | Engineering — validation tooling | Proof tooling only, not part of the installed application. The focused spike proofs pass. |
| R-D2-02 | The STOPPED screen's detail line reads "(STOPPED)" | Engineering — Desktop polish (Product wording sign-off) | Cosmetic. |
| R-D2-03 | Status inspection opens the store read-write, so SQLite checkpoints the WAL | Engineering — runtime / OPS | Behaviour to review against the read-only intent of `status`. |
| R-D2-04 | A Windows sign-out ends the user-session host. Desktop v1 has no autostart by design, so the Company stays stopped until the Founder reopens it (observed 2026-10-08, cause confirmed by the Windows log) | **Founder — Product decision** (unattended continuity), then Engineering | Input to the Continuity Proof stage. |
| R-D2-05 | The existing blocked CEO reply and historical FAILED / DEAD_LETTER work | Founder with Salim (P1 research) | Never retried automatically. Any retry is an explicit, governed Founder decision. |
| R-D2-06 | A Founder conversation creates a paid-by-default Work Item | **Founder — governance review** | Must be reviewed before P1 staffing or spending. |

## Lifecycle

- D1: CLOSED / MERGED / CANONICAL.
- D2: FOUNDER ACCEPTED / CLOSED, effective when this documentation PR merges.
- QANDEEL COMPANY Desktop v1: INSTALLED / ACCEPTED, with last verified health READY.
- P1 — First Production Staffing under Salim — is the next approved **planning** stage. It begins with research and
  discussion. No staffing, hiring, Academy qualification, activation, paid Work Item or spending is authorized by this
  closure; each needs its own Founder decision.
- P2, P3, Continuity Proof and Strong-v1 Closure remain future stages, not started.

No P1 functionality is claimed by this closure.
