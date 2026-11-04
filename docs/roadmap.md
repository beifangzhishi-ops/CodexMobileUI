# Staged implementation and acceptance

**Scope frozen for first release**. Add capabilities in isolated modules and validate each stage; do not make low-frequency Worktree features a blocker.

## Stage 1 — real Codex chat loop
- [x] Native Expo project structure, assistant-ui Native conversation primitives, Markdown renderer dependency.
- [x] OAuth PKCE + local gateway to shared Codex WS; local integration tests.
- [x] Read/write protocol adapters, thread snapshot parsing, SQLite cache and unsent offline drafts.
- [x] Cursor-based history pagination; malformed snapshots fail without clearing existing chat cache; finalized vs in-progress text handling and serialized draft writes.
- [x] Module checks, pure protocol tests and OAuth/relay loopback tests.
- [x] Android development-mode JS bundle exported by Metro (not an APK).
- [x] Read-only `initialize`, `thread/list`, and `thread/read` verified against both live shared App Servers (primary and second host). Sampled 6v message parts are all readable by the current text parser.
- [x] Owner-approved public Tailscale Funnel on dedicated 8443 for both hosts, preserving the primary host's other Funnel routes; independent 256-bit secret per gateway. Real public HTTPS PKCE + authenticated WSS `thread/list` and `thread/read` tests passed on both hosts, then test credentials revoked. Non-mobile privileged RPC methods are rejected at Gateway before forwarding.
- [x] Temporary local OAuth PKCE → authenticated gateway WSS → real 6v shared Codex `thread/list` verified with no persisted gateway setup.
- [x] **6v Android OAuth login** verified on an installed device: browser callback, code exchange, WebSocket authentication and App Server relay (2026-11-05).
- [ ] **noha Android OAuth login**, phone thread reads and actual message sending still require device validation.
- [x] Android ARM64 Debug APK and standalone Release test APK built with WCM; Release `assembleRelease` succeeded (605 tasks). Both were v2-signed and zipaligned; the Release APK contains a 2,952,600-byte JS bundle and 20 ARM64 native libraries. Tests currently use the project's debug signing key.
- [x] Shared Windows JDK 17, Node.js 24, Gradle 9.4.1, Android API 37, Build Tools 37, NDK 27.1 and CMake 3.31.6 / Ninja 1.12.1 checked; `scripts/build-android-windows.ps1` supports both variants, version validation and single-checkout build locking. Existing build caches are retained for incremental builds.
- [ ] Android installation and 6v OAuth callback passed; verify SecureStore persistence across restart, SQLite/offline launch, phone thread rendering, and live turns. Production signing and version upgrades remain separate acceptance items.
- [ ] Review/resolve remaining moderate Expo CLI/build-chain advisories before a public-facing release or production Funnel route.
- [ ] Actual thread read/send/streaming/reconnect validated alongside Codex Desktop and AOI.
- [ ] Native Markdown GFM and LaTeX verified on device, including long transcripts.

## Stage 2 — multi-client behavior
- Model/effort, permission modes, Plan/default, real approvals and blocking/nonblocking questions.
- Native pending-request replay and once-only answers across Desktop/AOI/mobile.
- Stop, steering/queue, compact/context usage, rename, fork at historical turn.

## Stage 3 — daily mobile features
- Host-independent full search and unread; task completion and approval local notifications via Funnel when the app process is running.
- `@` cross-conversation references (planned, not implemented): search and select other Codex threads from the current host in the composer, preserve their native `threadId` references instead of copying full histories, and support multiple references. Confirm the active App Server's supported read/search capabilities before implementation; fetch referenced content on demand with bounded, paginated long-thread handling. Keep references host-scoped, enforce Gateway RPC allowlisting and authorization, and test unsupported capabilities, missing threads and stale references on Android.
- Per-file 5 MiB upload limit, unrestricted files per message, independent progress, original Android URI+SHA-256 tracking, CCM-like preview/download **without CCM dependency**.
- Full and per-project AGENTS.md editor with concurrent edit protection; multi-host reliability and extensive offline recovery.

## Stage 4 — lower frequency
- Recognize Git worktrees from model-created branches and implement verified Desktop-managed Worktree B capabilities when supported (no Git diff UI).
- Goal, screenshots and optional auxiliary system tools where host supports them; stability, diagnostics, power and network behavior.

No FCM requirement: live app connection → Android local notification. If Android is killed/offline, immediate notification is not guaranteed; subsequent thread history and pending state sync when app reopens.
