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
- [x] Temporary local OAuth PKCE → authenticated gateway WSS → real 6v shared Codex `thread/list` verified with no persisted gateway setup.
- [ ] **Mobile OAuth through each host's authenticated gateway** verified on an installed Android device. Native thread reads through the phone are separate from the completed server-side read-only probes.
- [ ] Android APK built/signed, installed on an actual device; OAuth browser callback and secure token storage proven.
  - 2026-11-04 restricted-CCM build attempt: global JDK/SDK plus project-local `.tmp/gradle-user` and `.tmp/build-temp` got through Expo/React Native Kotlin, Java, resources and DEX tasks to ARM64 CMake/Ninja. Kotlin daemon and Android analytics paths outside the workspace raised permission warnings; Kotlin fallback compilation continued. CMake/Ninja then made no further observable progress for several minutes, so **only the identified build processes were terminated**; the SDK, Gradle caches and intermediate outputs remain. No APK was produced.
  - Follow-up isolation: NDK 27 Clang 18.0.2 ran normally; `cmake.exe -P CMakeFiles/VerifyGlobs.cmake` succeeded directly (exit 0), while running the existing Expo native Ninja graph stalled at its `cmake -P VerifyGlobs.cmake` child step. Even an isolated one-rule Ninja task that ran `cmake -E touch` did not exit normally when invoked through the restricted CCM runner, including PTY mode. The target file was created during the first reproduction, indicating a possible **child process completion/handle signaling** problem rather than a compiler or source error. The tiny tests ran only under ignored `.tmp/` and all their Ninja processes were stopped. **A full-access CCM Ninja reproduction is pending explicit approval**; that A/B comparison is still needed before declaring the sandbox the proven root cause. Do not reinstall SDK, modify third-party generated Ninja files, or touch shared App Servers to address this symptom.
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
