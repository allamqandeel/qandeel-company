# C1 — Company Foundation & Durable Runtime — Closure Record

> **C1 — CLOSED / READY FOR MERGE**

The **C1 gate is satisfied**. **PR #2 is still unmerged** until Founder merge approval.
**C2 is not started.**

- **Repository / PR:** `allamqandeel/qandeel-company`, PR #2 (branch
  `claude/dreamy-wozniak-nq3hr8`, base `main` at `deef86c`).
- **Validated code SHA:** `4140d5ee6de1b6b1d7c5379de3535320bf442b45`. This closure changes
  documentation only.
- **Exact-head CI:** run `36291573986` passed on Windows and Ubuntu.
- **Founder-host re-validation of that SHA:**
  - `npm run ci`: PASS. 174 tests, mutation check 6/6 caught, verifier 32/32.
  - Integration PASS; faults PASS.
  - The previously failing multi-process suite: 6/6 PASS.
  - Continuous-writer proof: 20/20 PASS, 60 backups. One real retry on run 17 after the first 5 s
    lock wait succeeded on the second attempt; 0 `STORAGE_BUSY` escaped.
  - Backup finalization tests: 8/8 PASS.
  - `C1 LOCAL ACCEPTANCE — PASS`; schema v3, WAL, integrity and backup verification PASS.
  - The canonical Company checkout was unchanged; the QANDEEL App was not accessed; no security
    settings were changed.
- **Evidence:** `docs/C1_IMPLEMENTATION_REPORT.md` (§0A, §0, §24) and decisions D-C1-01 to D-C1-24 in
  `docs/architecture/DECISION_LOG.md`.
- **Official-source follow-up:** completed during Founder-host re-validation; the required `sqlite.org` pages and Node 24 `node:sqlite` documentation were reachable and reviewed successfully.
