# CodexMobileUI staged roadmap

## Phase 1 — ChatGPT Android visual and interaction prototype (current branch)

- [x] Standalone worktree and isolated Expo/assistant-ui native layout: header, chat transcript, composer, left drawer.
- [x] Three permanent local test conversations, plus unlimited additional local conversations; per-chat message/draft separation.
- [x] Any nonempty prompt receives the literal local reply `测试成功`. Never connect Codex or request an API key for demo chat.
- [x] Drawer footer with placeholder avatar + `测试用户`, opening the account screen.
- [x] Reuse existing OAuth PKCE and host management from account screen only; authentication never switches demo messages to real ones.
- [x] Pure reducer tests and TypeScript checks.
- [x] Integrate validated short-path stable Windows build entry and existing privacy-safe OAuth diagnostics while keeping fake chats isolated.
- [x] Advance Android versionCode to 4 (0.2.0), beyond the separately built 0.1.2/versionCode 3.
- [x] Combined source, OAuth, diagnostics, demo and shared-contract automated checks: 57 passing tests.
- [ ] Android Release APK with embedded JS and visual inspection on a real device (drawer, keyboard resize, scrolling, back button, OAuth callback).

## Phase 2 — Real Codex chat (requires a separate explicit decision)

The original gateway, OAuth, protocol, SQLite and reconciliation adapters are retained but currently **not mounted** in the Android chat. Their previous loopback tests and gateway probes do not validate a working Android chat on a phone. When integration is requested, replace demo-thread IDs with authoritative native host-scoped IDs, and validate connected reads, streaming turns, reconnection and offline drafts on device. Never migrate fake demo messages into real Codex sessions implicitly.

## Phase 3 — Multi-client and daily-use features (planned)

- Model/effort, permissions, Plan Mode, approvals and native questions; stop, steering, compact/context usage.
- Host-scoped cross-conversation `@` references with native thread IDs and bounded on-demand reads; verify server capabilities and authorize any new gateway RPC before exposing it.
- Search, unread, local notifications while running, per-file upload/preview/download with size enforcement, Android URI+hash tracking.
- Global/project AGENTS.md editing, concurrency handling, reliability and privacy review.

## Phase 4 — Advanced operations (planned)

- Desktop-managed worktrees and safe branching capabilities subject to the real server API; no fabricated Git diff state.
- Optional auxiliary tools and deeper offline/power/reconnect diagnostics.

No Firebase Cloud Messaging dependency is assumed. Any future in-app local notification requires that an event reach the running mobile process. No staging item implies automatic permission to expose a new public service.
