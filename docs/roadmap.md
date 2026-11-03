# Staged implementation and acceptance

**Scope frozen for first release**. Add capabilities in isolated modules and validate each stage; do not make low-frequency Worktree features a blocker.

## Stage 1 — real Codex chat loop
- [x] Native Expo project structure, assistant-ui Native conversation primitives, Markdown renderer dependency.
- [x] OAuth PKCE + local gateway to shared Codex WS; local integration tests.
- [x] Read/write protocol adapters, thread snapshot parsing, SQLite cache and unsent offline drafts.
- [x] Cursor-based history pagination; malformed snapshots fail without clearing existing chat cache; finalized vs in-progress text handling and serialized draft writes.
- [x] Module checks, pure protocol tests and OAuth/relay loopback tests.
- [x] Android development-mode JS bundle exported by Metro (not an APK).
- [x] Read-only `initialize` and `thread/list` verified against the current 6v shared App Server.
- [x] Temporary local OAuth PKCE → authenticated gateway WSS → real 6v shared Codex `thread/list` verified with no persisted gateway setup.
- [ ] **Real Codex App Server authenticated connection** and native thread read on 6v, then noha.
- [ ] `thread/read` live compatibility probe while the shared App Server is listening; the read-only probe is prepared and does not start any service.
- [ ] Android APK built/signed, installed on an actual device; OAuth browser callback and secure token storage proven.
- [ ] Review/resolve remaining moderate Expo CLI/build-chain advisories before a public-facing release or production Funnel route.
- [ ] Actual thread read/send/streaming/reconnect validated alongside Codex Desktop and AOI.
- [ ] Native Markdown GFM and LaTeX verified on device, including long transcripts.

## Stage 2 — multi-client behavior
- Model/effort, permission modes, Plan/default, real approvals and blocking/nonblocking questions.
- Native pending-request replay and once-only answers across Desktop/AOI/mobile.
- Stop, steering/queue, compact/context usage, rename, fork at historical turn.

## Stage 3 — daily mobile features
- Host-independent full search and unread; task completion and approval local notifications via Funnel when the app process is running.
- Per-file 5 MiB upload limit, unrestricted files per message, independent progress, original Android URI+SHA-256 tracking, CCM-like preview/download **without CCM dependency**.
- Full and per-project AGENTS.md editor with concurrent edit protection; multi-host reliability and extensive offline recovery.

## Stage 4 — lower frequency
- Recognize Git worktrees from model-created branches and implement verified Desktop-managed Worktree B capabilities when supported (no Git diff UI).
- Goal, screenshots and optional auxiliary system tools where host supports them; stability, diagnostics, power and network behavior.

No FCM requirement: live app connection → Android local notification. If Android is killed/offline, immediate notification is not guaranteed; subsequent thread history and pending state sync when app reopens.
