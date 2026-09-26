# L0 Readiness Decision

**Status:** RECORD — sanitized. The full L0 report and manifest stay on the Founder machine and
are deliberately not copied here (they contain machine inventory).

| Item | Decision / result |
|---|---|
| L0 result | **PASS** on 2026-09-26 (local Environment Readiness Gate) |
| Canonical local workspace | `E:\QANDEEL COMPANY\PROJECT` |
| Smart App Control | **Enabled and stays enabled.** It blocks unsigned locally built executables / DLLs. Build on signed runtimes and script-level execution; never add security exclusions. |
| Git for HTTPS / hooks | Use **GitHub Desktop's signed bundled Git**, discovered at use time (its path changes when Desktop updates). System Git's HTTPS and shell components are blocked on this host; use it only for local, proven-safe operations. |
| Long paths | Repository-local `core.longpaths=true` is required. Without it, Git silently skips files beyond 260 characters. |
| Backups | Must be Unicode-safe (Arabic file names). **Never use Windows `tar.exe`**: it crashed on an Arabic file name and left a 0-byte archive. .NET ZipArchive and robocopy round-trips passed. |
| SQLite / WAL | PASS — WAL, a reader in another process not blocked by an open write, integrity check, online `backup()` and restore (Node built-in `node:sqlite`). |
| Secret protection | PASS — Windows DPAPI, CurrentUser scope, round trip; wrong entropy rejected. |
| Local IPC | PASS — named pipe and loopback-only TCP (not reachable from the LAN address). |
| Process lifecycle | PASS — start, clean stop, forced kill, restart; persisted state recovered. |
| Cloud handoff (local side) | PASS — clone, branch fetch and pull-request-head fetch into the local machine. |
| Claude GitHub App | Access to `allamqandeel/qandeel-company` must be confirmed **before the C1 Cloud build**. Status is recorded in `docs/C0_REPOSITORY_BOOTSTRAP_CLOSURE.md`. |
