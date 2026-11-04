# CodexMobileUI

An open-source-ready, **personal-use Android client** for the existing Codex App Server used by Codex Desktop. Chat sessions stay authoritative on the host PC; the phone caches messages and drafts.

**Status (2026-11-04): Stage 1 implementation in progress.** The Android application, OAuth PKCE flow, per-host gateway, native chat view, SQLite snapshot cache, and protocol tests have been implemented. TypeScript checks and gateway integration tests pass; a development-mode Android JS bundle was generated with Expo Metro. **Read-only native `thread/list` and `thread/read` have now succeeded against both host computers' live shared App Servers**, with schema-only probes showing the sampled message parts are compatible with the current text parser. A separate temporary localhost OAuth PKCE → authenticated WSS gateway → real `thread/list` probe succeeded on the primary host. **No Android APK has yet been verified or tested on a device, no production gateway is deployed, and mobile OAuth/live chat remain unverified.** Do not interpret this as a supported, fully operational client.

## Architecture

```text
Android / Expo + React Native + assistant-ui Native
  ├─ OAuth PKCE login, SecureStore
  ├─ native chat, Markdown renderer, offline drafts, SQLite cache
  └─ HTTPS / WSS via Funnel
        └─ CodexMobileUI gateway on selected Windows host
              ├─ OAuth authorization and token rotation
              ├─ authenticated WebSocket relay
              └─ local shared Codex App Server (actual Desktop thread IDs)
```

The app does not connect to CCM, AOI, CMP, or ChatGPT Desktop. Each target computer (6v/noha) has an independent gateway and authorization. This is a single-user product, **not** a public signup service. Never expose the raw Codex App Server or model credentials through Funnel.

## Implemented now

- Expo SDK 58 / React Native Android, `@assistant-ui/react-native` with a native Markdown renderer.
- Expo Dev Client dependency for validation of native modules that are not covered by Expo Go.
- Discover actual threads through paginated Codex `thread/list` (rather than silently truncating at 100), open with `thread/resume`, read turns via `thread/read`, and send user turns with `turn/start`.
- Stream agent text deltas when delivered by App Server and reconcile final turn history rather than building a second chat engine. `threadId`, `turnId` and `itemId` are used to deduplicate messages; completed items ignore late deltas. An invalid thread snapshot cannot erase cached history.
- Local SQLite snapshots of seen messages and threads; immediate, serialized local draft writes are never automatically sent on reconnection. In-progress agent output is not persisted as confirmed history.
- Per-host OAuth 2.0 authorization code + PKCE S256, short-lived access tokens, rotating refresh tokens, token revocation, local browser consent with a host-specific secret.
- Unit and integration tests for parser, OAuth, WSS authorization and JSON-RPC relay.

## Not implemented yet

The following are **planned**, not supported by the current build: verified real-host and Android-device integration; authenticated file upload/download/preview (5 MiB/file and individual progress); original mobile URI+SHA-256 attachment tracking; native local notifications; approval and user-question cards; model/effort, permissions and Plan Mode controls; search/unread; global/project AGENTS.md editing; usage/compact state; historical-turn fork; Worktree B, Goal and auxiliary controls. Native Markdown math rendering must be tested with a real Android build and long transcripts.

## Development on Windows

**Shared launchers (source added; live Windows behavior unverified):** `Start-CodexMobile.cmd` hot-attaches to an already healthy localhost 45789/45790 shared stack or starts an independently owned copy, then launches this checkout's authenticated Gateway on localhost 48888. `Stop-CodexMobile.cmd` stops only owned processes. The AOI-style Desktop entry `Start-Codex-Shared-Proxy.cmd` and independent `shared-start.cmd` / `shared-stop.cmd` are also included. Read [docs/shared-launcher.md](docs/shared-launcher.md) before use, especially its ownership and network-exposure cautions. The scripts do not call AOI at runtime.

The shared backend is sourced only from the newest complete Codex Desktop runtime; the independent runtime copy is a deployment cache, not a separate kernel version or alternate source.

Requires Node.js 24 and npm. A reusable Windows Android build setup is provided in [docs/windows-android-toolchain.md](docs/windows-android-toolchain.md) and [scripts/setup-android-toolchain.ps1](scripts/setup-android-toolchain.ps1): JDK 17, shared API 36/37 SDK platforms, Build Tools, NDK, CMake, adb and a shared Gradle cache. The tools were installed successfully on the primary Windows development host on 2026-11-04. Android Studio GUI and an emulator are optional for APK packaging. Expo Go alone cannot validate all native dependencies; use a **development build**.

Use absolute paths for commands, substituting the checkout location:

```powershell
Set-Location -LiteralPath 'C:\path\to\CodexMobileUI'
$env:npm_config_cache = 'C:\path\to\CodexMobileUI\.npm-cache'
npm.cmd ci
npm.cmd run check
npm.cmd run build:gateway
```

**Gateway (each host independently):** configure the environment variables in [`.env.example`](.env.example) without committing their values. Provide a long random `MOBILE_APPROVAL_SECRET`, the exact externally accessible `MOBILE_PUBLIC_ORIGIN`, and the localhost URL of the existing shared Codex App Server proxy. Run the compiled gateway on localhost:

```powershell
Set-Location -LiteralPath 'C:\path\to\CodexMobileUI'
$env:MOBILE_PUBLIC_ORIGIN = 'https://your-host.your-tailnet.ts.net'
$env:MOBILE_APPROVAL_SECRET = '<your-local-random-secret>'
$env:MOBILE_REDIRECT_URI = 'codexmobileui://oauth'
$env:CODEX_APP_SERVER_WS = 'ws://127.0.0.1:45789'
node.exe 'C:\path\to\CodexMobileUI\dist\gateway\main.js'
```

The gateway binds **127.0.0.1:48888 only**; configure a dedicated Funnel route after verifying authentication. Do **not** point Funnel directly to the shared Codex service. Do not expose it until the authorization and file/path boundaries have been reviewed against the actual environment. The example above is documentation, not a configured endpoint.

The user adds each computer's HTTPS origin from the Android app, opens a system-browser OAuth PKCE consent page, enters the computer's local authorization secret, and returns to the app. Tokens stay in Android SecureStore. Local state stays in the phone's SQLite database; no app-provided access to other Windows files is enabled in stage 1.

```powershell
Set-Location -LiteralPath 'C:\path\to\CodexMobileUI'
npm.cmd run android
```

`npm run android` requires a native Android build environment, and has **not yet been validated** on 6v.

## Tests, maintenance, and security

- `npm run check`: Android TypeScript, gateway TypeScript, unit + local integration tests.
- `npm run build:gateway`: gateway compilation.
- `npm run probe:readonly`: sends only `initialize` and `thread/list` to the existing loopback shared App Server; prints no private thread data.
- `node scripts/probe-thread-snapshot.mjs`: read-only check of `thread/read` on one existing local thread; outputs only structural counts, safe item/part type names and the number of messages the current parser can render. Requires the shared App Server to be running and does not start it.
- `npm run probe:authenticated`: after building the gateway, creates a temporary localhost-only OAuth grant and verifies an authenticated `thread/list` across the gateway to the existing shared app server, without changing the shared service or printing conversations.
- `npm run export:android`: JS bundle export, **not an APK**.
- Follow [docs/architecture.md](docs/architecture.md), [docs/roadmap.md](docs/roadmap.md), [SECURITY.md](SECURITY.md), and [AGENTS.md](AGENTS.md).
- Code and documentation are designed for public repository visibility: never commit local secrets, site-specific credentials, signature keys, OAuth state, downloaded private files, or real chat logs.

**Native build progress:** npm install in the restricted CCM environment required `--ignore-scripts`; native tree-sitter grammar assets were subsequently restored using the actual Windows terminal, and `expo prebuild --platform android --no-install` generated the Android Gradle project successfully. The global Android toolchain and Gradle 9.4.1 wrapper have been installed and independently verified. The original production Hermes export had failed with `spawn EPERM` in the restricted environment; native Android packaging and actual Markdown/LaTeX rendering are separate verification steps. The optional iOS RaTeX XCFramework extraction failed and has not been validated; this does not establish Android math support.

**Dependency security:** On 2026-11-04, `npm audit --omit=dev` still reported **6 moderate** advisories in Expo's dependency graph (`glob`/`minimatch` and dependent Expo CLI/build tooling), after applying all compatible non-force patches. Do not force the suggested Expo 51 downgrade: it breaks the chosen Expo 58/RN 0.88 setup. Recheck upstream fixes before any internet-exposed deployment.
