# CodexMobileUI

**Current branch: ChatGPT Android visual prototype (Expo / React Native).** The app opens into a **100% local fake chat**, intentionally not connected to any Codex App Server. This first UI phase focuses on the composer, transcript and left drawer before live protocol integration.

## Current Android UI

- ChatGPT Android-inspired dark transcript, top menu/new-chat actions, left sliding navigation drawer.
- Three permanent starting conversations (`测试聊天 1/2/3`); more can be created. Each preserves its own messages and unsent text while the app remains running.
- Enter and send any nonempty text; the only assistant response is exactly `测试成功`. Double tapping an empty composer cannot send duplicates. No network, token, API key or login is required for test chatting.
- Drawer footer shows a local placeholder avatar and `测试用户`; tap it to open account settings.
- The account screen can save HTTPS Funnel host origins and reuse the existing **real OAuth Authorization Code + PKCE** browser flow. Authentication is separate from fake chats: it does **not** connect chat history or invoke Codex.
- The fake chat state is currently **in memory only**; closing/restarting the app resets sample messages. Real-host SQLite caches and SecureStore OAuth tokens are unrelated and retained.

## Current verification

- `npm run check`: TypeScript (app + gateway), loopback OAuth/protocol tests, isolated demo reducer tests and shared launcher tests.
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

From the project directory on Windows, install the dependencies with `npm ci` if necessary, then run `npm run check`, `npm run export:android` and the native Android build script (`scripts/build-android-windows.ps1`) as appropriate. A standalone test APK must be a Release variant with embedded JS; Debug alone depends on Metro. The test signing key is not a production identity. Compare APK versionCode/versionName with `app.json` before distribution.

Current test-app version: **0.2.0 / Android versionCode 3**; application ID: `dev.codexmobileui.app`. The package is a private single-user prototype, **not** a public registration service. Never enable a public Funnel route or change a shared production backend without distinct owner authorization. See [docs/shared-launcher.md](docs/shared-launcher.md) before running the optional shared gateway launchers.
