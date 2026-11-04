# CodexMobileUI

**Current branch: ChatGPT Android visual prototype (Expo / React Native).** The app opens into a **100% local fake chat**, intentionally not connected to any Codex App Server. This first UI phase focuses on the composer, transcript and left drawer before live protocol integration.

## Current Android UI

- ChatGPT Android-inspired dark transcript, top menu/new-chat actions, left sliding navigation drawer.
- Three permanent starting conversations (`测试聊天 1/2/3`); more can be created. Each preserves its own messages and unsent text while the app remains running.
- Enter and send any nonempty text; the only assistant response is exactly `测试成功`. Double tapping an empty composer cannot send duplicates. No network, token, API key or login is required for test chatting.
- Drawer footer shows a local placeholder avatar and `测试用户`; tap it to open account settings.
- The account screen can save HTTPS Funnel host origins and reuse the existing **real OAuth Authorization Code + PKCE** browser flow. Authentication is separate from fake chats: it does **not** connect chat history or invoke Codex.
- The account screen has a **日志** action for privacy-safe OAuth diagnostics and an Android JSON export. A render-error fallback exposes diagnostic export without storing host identifiers or conversation text.
- The fake chat state is currently **in memory only**; closing/restarting the app resets sample messages. Real-host SQLite caches and SecureStore OAuth tokens are unrelated and retained.

## Current verification

- `npm run check`: TypeScript (app + gateway), loopback OAuth/protocol tests, isolated demo reducer tests, safe diagnostic tests, and shared launcher/build contracts.
- Android JS export and Release APK / physical-device interaction must be separately validated; TypeScript and mock tests alone are not evidence of a working Android APK or OAuth browser return.
- Earlier verified gateway/relay functionality remains in the source tree but is **not called by the current Android chat UI**. The native chat integration is deferred until the owner approves the next phase.

## Architecture

```text
Expo Android app
  ├── DemoChat (assistant-ui Native transcript + editable composer)
  │     └── src/demo/conversations.ts (3 seeded / new threads, local-only replies)
  ├── ChatSidebar (thread navigation + test user)
  └── AccountScreen (saved host origins + existing OAuthLogin)
        └── SQLite hosts + SecureStore OAuth credentials (not used for demo chat)

Dormant integration modules: src/core, src/session, gateway, SQLite thread caches.
```

No real host address, OAuth consent secret, refresh token, signing material or personal chat log belongs in Git. See [docs/architecture.md](docs/architecture.md) for the isolated demo boundary and [docs/roadmap.md](docs/roadmap.md) for next stages.

## Develop and verify

Use the verified stable native packaging entry `scripts/build-android-stable.ps1` from the visual-prototype worktree, with `-BuildRoot C:\Users\Songjx\cmui-build-v011`. It syncs the selected worktree sources to a persistent short-path build checkout, reuses lockfile-matched dependencies and Gradle/CMake caches, and validates the signed APK before copying it to this worktree's ignored `.tmp/android-artifacts`. Do not use a junction pointing to the main checkout's `node_modules`. A standalone test APK must contain embedded JS; Debug needs Metro. The already verified `0.1.1` and `0.1.2` artifacts in the main checkout remain intact.

The stable preflight also checks that Expo package ID, Gradle namespace/application ID, and native Kotlin entrypoint packages agree. During source sync, obsolete Java/Kotlin application package paths are removed from the *staged checkout only*, without clearing native build caches. This prevents a renamed app from compiling against an old generated `R`/`BuildConfig` package.
After a native package change, the builder also selectively invalidates React Native's cached `autolinking.json` and generated application entrypoint. This avoids stale Java `BuildConfig` imports without running a full Gradle/CMake clean.

Current test-app version: **0.2.0 / Android versionCode 4**; application ID: `dev.codexmobileui.app`. The package is a private single-user prototype, **not** a public registration service. Never enable a public Funnel route or change a shared production backend without distinct owner authorization. See [docs/shared-launcher.md](docs/shared-launcher.md) before running the optional shared gateway launchers.
