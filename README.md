# CodexMobileUI

An open-source-ready, **personal-use Android client** for the existing Codex App Server used by Codex Desktop. Chat sessions stay authoritative on the host PC; the phone caches messages and drafts.

**Status (2026-11-04): Stage 1 implementation, Android packaging and both host Funnel gateways verified; device interaction remains in progress.** The Expo/React Native app, per-host OAuth PKCE gateway, native chat UI, SQLite cache and Codex protocol adapter are implemented. On 6v, an earlier full-permission build produced and verified ARM64 Debug and standalone Release test APKs; the owner reports installing the app on Android. The gateway on **each host** is reachable through independent public HTTPS Tailscale Funnel on port 8443, forwarding only to loopback 48888. Both hosts passed a real **Funnel HTTPS OAuth PKCE → WSS authenticated thread/list and thread/read probe**, with test credentials revoked afterwards. The gateway enforces an explicit RPC method allowlist. **Android browser callback, phone UI state, live mobile turns and multi-client behavior still require device validation.** The Release test APK uses a debug signing key and is not production signed.

**OAuth correction rollout (2026-11-04):** Source commits `3cd72e9` and `18a8b52` implement CCM-style revalidated authorization parameters, persisted ten-minute codes, retryable HTML consent, and a guarded Android browser callback. Automated source tests and a localhost authenticated real App Server probe passed. **6v is now deployed and verified**: its restarted Gateway listens on loopback 48888, and the actual public Funnel probe passed wrong-secret HTML retry, HTTPS PKCE token exchange, authenticated WSS thread listing, and read-only thread content retrieval. The second-host deployment-only ZIP is prepared without private secrets but has **not yet been installed**, so noha still requires this rollout. The previously installed Android 0.1.0 APK predates these changes. A separate 0.1.1 standalone Release APK has now been compiled and its APK metadata, signature and JS bundle checked; installation and real Android deep-link callback tests are still needed.

**Android first-tap status (2026-11-05):** The OAuth first-tap correction was shipped with Android 0.1.1 (versionCode 2), but the owner still reports no visible response after tapping the authorization button. The root cause is **not yet proven**. Android 0.1.2 (versionCode 3) adds local diagnostics, touch and browser-stage instrumentation and a user-triggered JSON export. The separate, verified Windows Gateway/Funnel PKCE probe is not equivalent to a successful Android browser callback. Phone-based log export and OAuth retesting are required before declaring this issue fixed.

**Reproducible Android build chain (2026-11-04):** Use scripts/build-android-stable.ps1 for source-to-APK builds. It operates on a single persistent short-path checkout outside the source tree, reuses dependency-lockfile-matched node_modules and Gradle/CMake outputs, checks active build locks, verifies all version identifiers and the APK signature, records build transcripts, and publishes verified files under ignored .tmp/android-artifacts. The earlier 0.1.0 APK does not contain the 0.1.1 OAuth correction. See docs/windows-android-toolchain.md for the stable build command and verification requirements.

**APK delivery (2026-11-04):** After local APK/version/signature/bundle validation, upload each new Android APK through CCM's 6v Quark Cloud Drive integration by default, and wait for the remote upload to finish. The verified 0.1.1 ARM64 test Release APK (`CodexMobileUI-0.1.1-release-arm64.apk`, 38,194,295 bytes) was uploaded successfully to Quark's **夸克上传文件** folder, reporting `FINISH` and 100% completion. The cloud upload is a delivery step, not evidence of on-device OAuth validation. Do not upload secrets, local gateway configuration, or debug signing keys.

**On-device diagnostics (0.1.2 / Android versionCode 3):** Because OAuth authorization still did not visibly respond on the owner's phone after installing 0.1.1, the Android client now exposes a persistent **日志** button at the top of the application (also available during initial loading). It records the initial touch and press separately, OAuth PKCE generation, browser launch/pending/result, callback validation, token exchange and SecureStore operations; it also tracks app foreground/background/deep-link delivery, WebSocket/RPC activity, reconnects, thread/cache operations and classified failures. Tap **日志 → 导出 JSON 日志（系统分享）** to export a time-stamped JSON file using Android's share sheet. The diagnostics screen displays the **native installed app version/build number**, recent events and the persistent-storage status; it can refresh or clear the journal. Logs persist in their own SQLite database across restarts and are bounded to 1,800 entries / 7 days. Only allowlisted metadata is stored: **never** OAuth secrets/codes/state/verifiers, host addresses, tokens, thread identifiers, full errors, raw requests/responses or chat text. A device-native crash before JavaScript initializes may not be captured; Android logcat is needed for that. The 0.1.2 artifact requires release compilation and real Android testing before this feature can be marked device-verified.

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
- OAuth consent follows CCM's validated request/consent flow. The validated PKCE fields survive re-display, bad keys show an in-page retry form, and one-use authorization codes persist for ten minutes across Gateway restarts. Android handles the browser's returned result directly before storing tokens. Safe path/status/duration and fixed event logs exclude credentials, callback URLs, token values, thread data and request bodies. The updated Gateway has been deployed to 6v; deploy it to noha and install a newly built Android APK to validate the changed client.
- Unit and integration tests for parser, OAuth, WSS authorization and JSON-RPC relay.

## Not implemented yet

The following are **planned**, not yet supported or device-validated: Android OAuth browser callback and authenticated phone chat across both hosts; file upload/download/preview (5 MiB/file with individual progress); original mobile URI+SHA-256 attachment tracking; native local notifications; approval and user-question cards; model/effort, permissions and Plan Mode controls; search/unread; Stage 3 composer `@` references to other Codex threads (host-scoped picker and on-demand reads, not full-history copying); global/project AGENTS.md editing; usage/compact state; historical-turn fork; Worktree B, Goal and auxiliary controls. GFM Markdown and native math rendering need tests on a physical Android phone and with long transcripts. See [docs/roadmap.md](docs/roadmap.md) for the cross-conversation reference acceptance scope.

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

**Native build:** On 6v the shared Windows toolchain is JDK 17, Node.js 24, Gradle 9.4.1, Android API 37 / Build Tools 37, NDK 27.1, and CMake 3.31.6 / Ninja 1.12.1. The earlier full-permission build produced `android/app/build/outputs/apk/debug/app-debug.apk` (needs Metro) and `android/app/build/outputs/apk/release/app-release.apk` (contains `assets/index.android.bundle` so it does not need Metro). The Release test APK is signed using the current project debug keystore; v2 signature and zipalign checks passed. Use `scripts/build-android-stable.ps1` for future builds: Release by default, `-Variant Debug` for development, `-CheckOnly` for version checks, and `-RegenerateCMake` only when intentionally changing the native build graph. A per-checkout lock prevents concurrent runs through the script. Real Android device validation is still pending.

**Dependency security:** On 2026-11-04, `npm audit --omit=dev` still reported **6 moderate** advisories in Expo's dependency graph (`glob`/`minimatch` and dependent Expo CLI/build tooling), after applying all compatible non-force patches. Do not force the suggested Expo 51 downgrade: it breaks the chosen Expo 58/RN 0.88 setup. Recheck upstream fixes before any internet-exposed deployment.
