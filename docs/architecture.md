# CodexMobileUI architecture

## Current Android application: visual test mode

The default Expo/React Native entry point `App.tsx` renders `DemoChat`, `ChatSidebar` and `AccountScreen`. The main chat does **not** authenticate or connect to a computer. `src/demo/conversations.ts` is an isolated in-memory reducer with exactly three initial samples; user messages receive the literal reply `测试成功`. New chats and per-chat drafts exist only for the current app session. These sample IDs must never be reused as native Codex thread IDs or written to the real SQLite thread/message tables.

The `@assistant-ui/react-native` runtime and primitives render native transcript messages. The input remains a React Native controlled multiline TextInput, and messages are never sent to `src/session` or `src/core/transport`.

`src/diagnostics` is a separate, bounded, privacy-sanitized event journal. The demo app logs startup and deep-link lifecycle events without saving raw URLs or conversation text. The account page can show the on-device JSON export dialog, including when host loading or OAuth authorization fails. A React error boundary also exposes diagnostic export if the UI cannot render. The existing OAuth implementation retains its PKCE/browser/secure-token instrumentation.

## Real OAuth account boundary

The bottom-left user avatar opens `AccountScreen` without affecting fake chat content. The account page loads/stores selected HTTPS gateway hosts with SQLite, checks saved tokens in SecureStore and invokes the existing `src/auth/Login.tsx` only when the user actively taps the OAuth authorization button. The real PKCE + browser callback and token exchange code has not been replaced by a mock. Successful authorization changes only account status; it never enables live chat in this phase. OAuth browser callback still requires Android device verification.

## Dormant integration modules

- `src/core/host.ts`: validate HTTPS gateway roots; no URLs embedded in app source.
- `src/core/protocol.ts`, `src/core/threadApi.ts`, `src/core/transport.ts`: authoritative Codex RPC types, pagination, WSS transport, retained for the next integration phase.
- `src/session/`: Codex thread subscription, event/reconnection reconciliation; **not mounted** in the demo UI.
- `src/storage/`: persistent real host records, Codex thread snapshots and drafts; demo threads do not touch the latter.
- `src/auth/`: real browser OAuth PKCE and token lifecycle.
- `gateway/`: independent owner-authenticated OAuth gateway and allowlisted WebSocket relay to the shared App Server. No fake chat requests reach this gateway.

The original production trust boundary is unchanged: public Funnel must expose only the authenticated gateway, never the raw shared App Server, and credentials must never be printed, hardcoded or committed. Privileged native RPCs require allowlisting and authorization tests before exposure. Shared Desktop, AOI and Codex server lifecycle must not be controlled by the Android app.

## Validation boundary

Reducer and gateway tests are automatable in a local development sandbox. Native drawer gestures, text-input resizing, safe areas, real OAuth callback and Android installation require separate device evidence. Record such results only when directly observed; an exported JS bundle is not an APK.

For Android Release builds, use `scripts/build-android-stable.ps1` against a persistent short-path checkout, with an explicit lock and cached dependencies. Do not link the isolated worktree to the main checkout's `node_modules`, as that causes overlapping native CMake intermediates. Verify package identity, `versionCode`, bundled JS and signing before treating an APK as a release artifact.
