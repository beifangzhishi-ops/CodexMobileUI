# Staged implementation and acceptance

## Stage 1.5 — delayed sessions and native project synchronization (0.1.4)
- [x] Local pending conversation with no early `thread/start`; first user send creates exactly one native thread then starts its turn. SQLite pending selection/draft recovery and ambiguous-send guard implemented with tests.
- [x] `project/list` and `thread.projectId` incorporated as the canonical project catalog; cwd-only fallback for old project classification and an explicit uncategorized group.
- [x] Projectless first-send requests an isolated cwd from the authenticated Gateway, created through native `fs/createDirectory`, not a new shell command executor.
- [x] Real thread moves use `thread/metadata/update` and re-read server ownership; mobile rename and a bounded ephemeral automatic-title worker use `thread/name/set`. Move never relocates cwd/files.
- [x] Two actual shared App Servers verified project listing, project-assigned thread creation and moving with disposable threads; both test threads and native filesystem test directories were deleted.
- [x] Gateway strict RPC filtering and local unit/integration tests. Full file upload/preview/download UI remains part of Stage 3 for both project and projectless chats.
- [ ] Install and validate the new 0.1.4 APK on Android (new chat, first-send, project chooser, move, rename, keyboard and restart recovery).
- [ ] Observe Desktop sidebar after a real user-initiated project move. No conflict was detected in short App Server read-back; Desktop persistence/reversion is still unknown.

**Android keyboard regression (mainline 0.1.3 / versionCode 5):** Add explicit `KeyboardAvoidingView` `behavior="padding"` around the real-chat transcript and composer while retaining Expo Android `resize` settings. This is a source fix plus an automated structural check; only an actual Redmi K80 installation can verify the composer moves above the keyboard, multiline editing, and scroll positioning.

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
- [x] **6v Android live Codex RPC chat** verified with an installed 0.1.2 APK: authenticated WebSocket, existing thread reads, successful `turn/start` and `turn/completed`, and follow-up authoritative `thread/read` (diagnostic export 2026-11-05 local time).
- [ ] **noha Android OAuth login** and updated all-provider history/new-thread behavior still require device validation.
- [x] Android ARM64 Debug APK and standalone Release test APK built with WCM; Release `assembleRelease` succeeded (605 tasks). Both were v2-signed and zipaligned; the Release APK contains a 2,952,600-byte JS bundle and 20 ARM64 native libraries. Tests currently use the project's debug signing key.
- [x] Shared Windows JDK 17, Node.js 24, Gradle 9.4.1, Android API 37, Build Tools 37, NDK 27.1 and CMake 3.31.6 / Ninja 1.12.1 checked; `scripts/build-android-windows.ps1` supports both variants, version validation and single-checkout build locking. Existing build caches are retained for incremental builds.
- [ ] 6v Android OAuth and real chat RPCs passed; verify offline recovery, SecureStore persistence, full rendered transcripts and the updated empty-thread flow after packaging. Production signing remains separate.
- [ ] Review/resolve remaining moderate Expo CLI/build-chain advisories before a public-facing release or production Funnel route.
- [ ] Cross-client Desktop/AOI consistency, long streaming and reconnection validation remains outstanding; Android turn start/completion/read is already verified on 6v.
- [ ] Native Markdown GFM and LaTeX verified on device, including long transcripts.

## Stage 2 — multi-client behavior
- Model/effort, permission modes, Plan/default, real approvals and blocking/nonblocking questions.
- Native pending-request replay and once-only answers across Desktop/AOI/mobile.
- Stop, steering/queue, compact/context usage and fork at historical turn. Thread renaming is part of Stage 1.5.

## Stage 3 — daily mobile features
- Host-independent full search and unread; task completion and approval local notifications via Funnel when the app process is running.
- `@` cross-conversation references (planned, not implemented): search and select other Codex threads from the current host in the composer, preserve their native `threadId` references instead of copying full histories, and support multiple references. Confirm the active App Server's supported read/search capabilities before implementation; fetch referenced content on demand with bounded, paginated long-thread handling. Keep references host-scoped, enforce Gateway RPC allowlisting and authorization, and test unsupported capabilities, missing threads and stale references on Android.
- Per-file 5 MiB upload limit, unrestricted files per message, independent progress, original Android URI+SHA-256 tracking, CCM-like preview/download **without CCM dependency**.
- Full and per-project AGENTS.md editor with concurrent edit protection; multi-host reliability and extensive offline recovery.

## Stage 4 — lower frequency
- Recognize Git worktrees from model-created branches and implement verified Desktop-managed Worktree B capabilities when supported (no Git diff UI).
- Goal, screenshots and optional auxiliary system tools where host supports them; stability, diagnostics, power and network behavior.

No FCM requirement: live app connection → Android local notification. If Android is killed/offline, immediate notification is not guaranteed; subsequent thread history and pending state sync when app reopens.
