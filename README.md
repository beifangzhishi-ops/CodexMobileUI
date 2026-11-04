# CodexMobileUI

An open-source-ready, **personal-use Android client** for the existing Codex App Server used by Codex Desktop. Chat sessions stay authoritative on the host PC; the phone caches messages and drafts.

**Status (2026-11-04): Stage 1 implementation, Android packaging and both host Funnel gateways verified; device interaction remains in progress.** The Expo/React Native app, per-host OAuth PKCE gateway, native chat UI, SQLite cache and Codex protocol adapter are implemented. On 6v, WCM built and verified ARM64 Debug and standalone Release test APKs; the owner reports installing the app on Android. The gateway on **each host** is reachable through independent public HTTPS Tailscale Funnel on port 8443, forwarding only to loopback 48888. Both hosts passed a real **Funnel HTTPS OAuth PKCE → WSS authenticated thread/list and thread/read probe**, with test credentials revoked afterwards. The gateway enforces an explicit RPC method allowlist. **Android browser callback, phone UI state, live mobile turns and multi-client behavior still require device validation.** The Release test APK uses a debug signing key and is not production signed.

**OAuth correction rollout (2026-11-04):** Source commits `3cd72e9` and `18a8b52` implement CCM-style revalidated authorization parameters, persisted ten-minute codes, retryable HTML consent, and a guarded Android browser callback. All 45 source tests and a localhost authenticated real App Server probe passed. The existing APK predates these changes and **must not be presented as the new build**. A restricted CCM Release build stopped before producing an APK; isolated Metro bundling reached Hermes but failed to spawn the compiler (`EPERM`). An authorized native build and installation are still needed. Running Funnel gateways have not yet been restarted with the updated compiled server; public HTTPS regression against the new flow and on-device callback remain pending. The second-host deployment-only ZIP has been prepared without private secrets but not installed.

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
- OAuth consent follows CCM's validated request/consent flow rather than relying on a timed in-memory approval ID. The original validated PKCE fields survive re-display, bad keys show an in-page retry form, and one-use authorization codes persist for ten minutes across Gateway restarts. Android handles the browser's returned result directly before storing tokens. Safe path/status/duration and fixed event logs exclude credentials, callback URLs, token values, thread data and request bodies. Deploy the new Gateway to each host and install a newly built Android APK to test the changed client.
- Unit and integration tests for parser, OAuth, WSS authorization and JSON-RPC relay.

## Not implemented yet

The following are **planned**, not yet supported or device-validated: Android OAuth browser callback and authenticated phone chat across both hosts; file upload/download/preview (5 MiB/file with individual progress); original mobile URI+SHA-256 attachment tracking; native local notifications; approval and user-question cards; model/effort, permissions and Plan Mode controls; search/unread; global/project AGENTS.md editing; usage/compact state; historical-turn fork; Worktree B, Goal and auxiliary controls. GFM Markdown and native math rendering need tests on a physical Android phone and with long transcripts.

## Development on Windows

**Shared launchers (source added; live Windows behavior unverified):** `Start-CodexMobile.cmd` hot-attaches to an already healthy localhost 45789/45790 shared stack or starts an independently owned copy, then launches this checkout's authenticated Gateway on localhost 48888. `Stop-CodexMobile.cmd` stops only this checkout's Gateway, never the shared stack. The AOI-style Desktop entry `Start-Codex-Shared-Proxy.cmd` and independent administrative `shared-start.cmd` / `shared-stop.cmd` are also included. Read [docs/shared-launcher.md](docs/shared-launcher.md) before use, especially its ownership and network-exposure cautions. The scripts do not call AOI at runtime.

The normal MobileUI stop button/script stops **only its Gateway**; shared App Server 45789/45790 remains available for AOI and Desktop. To explicitly shut down the shared kernel, use the separately named owner-only `shared-stop.cmd` only after confirming other clients are idle.

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

**Gateway (each host independently):** the owner-authorized Funnel deployment is now live on both host computers. See [docs/funnel-deployment.md](docs/funnel-deployment.md) for the operational steps and dedicated port layout. The primary host runs the built gateway directly; the second host uses a separately packaged, compiled gateway runtime. Both use independent 256-bit host-specific OAuth approval secrets in private `.env` files. Never commit or share them. To rebuild a gateway after source changes use `npm run build:gateway`, then redeploy with the package script.

```powershell
Set-Location -LiteralPath 'C:\path\to\CodexMobileUI'
$env:MOBILE_PUBLIC_ORIGIN = 'https://your-host.your-tailnet.ts.net:8443'
$env:MOBILE_APPROVAL_SECRET = '<your-local-random-secret>'
$env:MOBILE_REDIRECT_URI = 'codexmobileui://oauth'
$env:CODEX_APP_SERVER_WS = 'ws://127.0.0.1:45789'
node.exe 'C:\path\to\CodexMobileUI\dist\gateway\main.js'
```

The gateway binds **127.0.0.1:48888 only**; the two active mobile Funnel routes use HTTPS **8443**, preserving other existing Funnel services. Never point Funnel directly to the shared Codex service. The gateway explicitly restricts native RPC methods, but a permitted `turn/start` may still run privileged host-side Codex tools. The command block above is generic documentation, not a substitute for each host's ignored, generated configuration.

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

**Native build:** On 6v the shared Windows toolchain is JDK 17, Node.js 24, Gradle 9.4.1, Android API 37 / Build Tools 37, NDK 27.1, and CMake 3.31.6 / Ninja 1.12.1. WCM successfully built `android/app/build/outputs/apk/debug/app-debug.apk` (needs Metro) and `android/app/build/outputs/apk/release/app-release.apk` (contains `assets/index.android.bundle` so it does not need Metro). The Release test APK is signed using the current project debug keystore; v2 signature and zipalign checks passed. Use `scripts/build-android-windows.ps1` for future builds: Release by default, `-Variant Debug` for development, `-CheckOnly` for version checks, and `-RegenerateCMake` only when intentionally changing the native build graph. A per-checkout lock prevents concurrent runs through the script. Real Android device validation is still pending.

**Dependency security:** On 2026-11-04, `npm audit --omit=dev` still reported **6 moderate** advisories in Expo's dependency graph (`glob`/`minimatch` and dependent Expo CLI/build tooling), after applying all compatible non-force patches. Do not force the suggested Expo 51 downgrade: it breaks the chosen Expo 58/RN 0.88 setup. Recheck upstream fixes before any internet-exposed deployment.
