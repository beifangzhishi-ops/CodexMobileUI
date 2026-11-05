# CodexMobileUI

An open-source-ready, **personal-use Android client** for the existing Codex App Server used by Codex Desktop. Chat sessions stay authoritative on the host PC; the phone caches messages and drafts.

**Status (2026-11-05): the source now targets 0.1.4 / Android versionCode 6.** It implements delayed creation of real threads, native Codex project synchronization, projectless per-conversation workspace preparation, native project moves, manual rename and background automatic titles. All feature checks and live project/filesystem protocol probes have passed on both shared App Servers; **these new flows still need physical Android testing**. The previously verified 0.1.3 standalone ARM64 Release was uploaded to Quark. The test Release uses a debug signing certificate; noha mobile login and offline recovery remain unverified.

**OAuth correction rollout (2026-11-05):** After repeated authorized browser POST responses failed to return to Android, both hosts deployed an approval-success page with an explicit Return to CodexMobileUI link. The 6v real-phone attempt on 2026-11-05 succeeded: consent, token issue, authenticated WebSocket and upstream connection are recorded by the Gateway. noha's mobile OAuth remains untested, although its independent Gateway and public HTTPS health checks passed.

**Android OAuth UI and diagnostics:** Installed Android 0.1.2 (versionCode 3) has an active OAuth button and safe diagnostic export. The confirmed 6v login used this installed APK without a rebuild; the required fix was deployed in the Gateway consent success page. The separate browser callback and PKCE token exchange are now verified on the phone for 6v.

**Recoverable Android build chain (2026-11-05):** The fixed scripts/build-android-stable.ps1 entry point keeps its short-path build checkout, incremental npm/Gradle/CMake caches, exclusive locks and signed ARM64 Release output. It now records build phase, source fingerprint, timestamp and result atomically in the external checkout, and captures native Gradle output in a separate persistent log. If the calling PowerShell exits but Gradle produces an APK, a subsequent invocation can resume **verification and publication without recompiling**, only when the recorded source/version/timestamp match and package, signature, embedded JS and SHA-256 checks pass. The verified 0.1.3 APK was uploaded to Quark on 2026-11-05. See docs/windows-android-toolchain.md for details.

**APK delivery (2026-11-04):** After local APK/version/signature/bundle validation, upload each new Android APK through CCM's 6v Quark Cloud Drive integration by default, and wait for the remote upload to finish. The verified 0.1.1 ARM64 test Release APK (`CodexMobileUI-0.1.1-release-arm64.apk`, 38,194,295 bytes) was uploaded successfully to Quark's **夸克上传文件** folder, reporting `FINISH` and 100% completion. The cloud upload is a delivery step, not evidence of on-device OAuth validation. Do not upload secrets, local gateway configuration, or debug signing keys.

**On-device diagnostics (0.1.2 / Android versionCode 3):** The installed Android APK provides a persistent diagnostics screen and time-stamped JSON export through the system share sheet. It tracks OAuth press, PKCE, browser callback, token exchange, SecureStore and WebSocket stages, plus connection and recovery metadata. A real device successfully exported a log; the same installed APK subsequently completed real OAuth login to 6v. Diagnostic records use a separate bounded SQLite database (1,800 entries / 7 days) and allowlist safe fields, never hostnames, OAuth codes, state, verifiers, tokens, thread IDs, chat content or raw errors. Native crashes before JavaScript starts still require Android logcat.

**Gateway request tracing (2026-11-05):** Both Gateways persist sanitized HTTP/WebSocket events and allowlisted OAuth decisions in ignored .state/mobile-gateway-requests.jsonl. The 6v log confirms real Android consent success at 02:35:49 local time, successful OAuth token exchange at 02:35:52, authenticated WebSocket at 02:35:53 and upstream readiness. Never store raw request URLs, client IPs, codes, tokens or chat content.

**Dual-host Funnel verification and CCM permissions (2026-11-05):** Both full CodexMobileUI repositories run independent loopback 48888 Gateways behind Tailscale Funnel HTTPS port 8443. Cross-machine public HTTPS health checks returned HTTP 200. CCM Tailscale whitelist checks must contain exactly one standalone tailscale.exe command per exec_command, yielding trusted_tailscale: true and exit code 0. Other privileged process changes require scoped require_escalated approval, not a global Full Access grant.

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
- Discover threads across **all recorded model providers** via cursor-paginated Codex `thread/list`; resume existing persisted threads, read turns via `thread/read`, and send via `turn/start`. A newly selected blank chat is entirely local and does **not** call `thread/start` until its first actual message; failure after creating a real ID retains that ID rather than silently creating another thread.
- Read genuine Desktop projects through experimental `project/list` (including ID, name, roots and position), use explicit project IDs for new threads, and group older conversations by the longest matching native project root if their ID is absent. Unknown historical threads remain uncategorized.
- A projectless chat gets its own stable directory under `Documents/Codex/MobileUI/YYYY-MM-DD/<draft-id>`, created only on first send by the shared App Server's native `fs/createDirectory` through a strictly limited, authenticated Gateway operation. Native `workspace-write` and `on-request` are requested for these chats; actual Windows enforcement remains subject to the host's Codex configuration.
- Move existing conversations to another real project with `thread/metadata/update`, and rename them manually with `thread/name/set`. Moving a thread changes only project assignment, never the original cwd or files. Automatically generated short names use a separate restricted ephemeral Codex thread after the first completed turn, without overwriting manual names. Desktop's sidebar may maintain an independent assignment cache; actual desktop-visible behavior must be checked.
- Stream agent text deltas when delivered by App Server and reconcile final turn history rather than building a second chat engine. `threadId`, `turnId` and `itemId` are used to deduplicate messages; completed items ignore late deltas. An invalid thread snapshot cannot erase cached history.
- Local SQLite snapshots of seen messages and threads; immediate, serialized local draft writes are never automatically sent on reconnection. In-progress agent output is not persisted as confirmed history.
- Per-host OAuth 2.0 authorization code + PKCE S256, short-lived access tokens, rotating refresh tokens, token revocation, local browser consent with a host-specific secret.
- OAuth consent validates the PKCE request on GET and POST; bad keys retain the form for correction. After a correct key, the Gateway renders a no-store approval page with an explicit **Return to CodexMobileUI** link rather than relying on Android Chrome to follow a POST 302 to a custom scheme. The user taps that link to deliver the one-use, ten-minute code to the Android app; the app then exchanges it with PKCE before storing tokens. The Gateway never logs codes, callback URLs or credentials. Gateway integration tests cover the approval page and code exchange; the real Android OAuth callback and token exchange have passed against 6v.
- Unit and integration tests for parser, OAuth, WSS authorization and JSON-RPC relay.

## Not implemented yet

The following are **planned**, not yet supported or device-validated: phone login against noha; physical Android verification of the new 0.1.4 session/project/move/title flow; a common file upload/download/preview interface for both project and projectless chats (5 MiB/file with individual progress); original mobile URI+SHA-256 attachment tracking; native local notifications; approval and user-question cards; model/effort, permissions and Plan Mode controls; search/unread; Stage 3 composer `@` references to other Codex threads (host-scoped picker and on-demand reads, not full-history copying); global/project AGENTS.md editing; usage/compact state; historical-turn fork; Worktree B, Goal and auxiliary controls. GFM Markdown, native math, and keyboard focus still need physical Android testing. See [docs/roadmap.md](docs/roadmap.md).

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

**Gateway (each host independently):** Both hosts have a full checkout in their user Documents\ChatGPT\CodexMobileUI directory, build identical Gateway source and run separately with private per-host .env and .state. Noha runs its new checkout Gateway through the existing Funnel, without changing the shared Codex App Server, Desktop, or AOI. Synchronize Git commits on both machines; no remote is currently configured. Keep secrets, local state, signing keys and build caches out of Git. See docs/funnel-deployment.md for host-specific operation and diagnostics.The gateway binds **127.0.0.1:48888 only**; the two active mobile Funnel routes use HTTPS **8443**, preserving other existing Funnel services. Never point Funnel directly to the shared Codex service. The gateway explicitly restricts native RPC methods, but a permitted `turn/start` may still run privileged host-side Codex tools. The command block above is generic documentation, not a substitute for each host's ignored, generated configuration.

The user adds each computer's HTTPS origin from the Android app, opens a system-browser OAuth PKCE consent page, enters the computer's local authorization secret, then **taps Return to CodexMobileUI on the approval page** to open the app. Tokens stay in Android SecureStore. Local state stays in the phone's SQLite database; no app-provided access to other Windows files is enabled in stage 1.

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

**Native build:** On 6v the shared Windows toolchain is JDK 17, Node.js 24, Gradle 9.4.1, Android API 37 / Build Tools 37, NDK 27.1, and CMake 3.31.6 / Ninja 1.12.1. The earlier full-permission build produced `android/app/build/outputs/apk/debug/app-debug.apk` (needs Metro) and `android/app/build/outputs/apk/release/app-release.apk` (contains `assets/index.android.bundle` so it does not need Metro). The Release test APK is signed using the current project debug keystore; v2 signature and zipalign checks passed. Use `scripts/build-android-stable.ps1` for future builds: Release by default, `-Variant Debug` for development, `-CheckOnly` for version checks, and `-RegenerateCMake` only when intentionally changing the native build graph. A per-checkout lock prevents concurrent runs through the script. Android 0.1.2 has verified authenticated live chat RPCs on 6v; the updated history/new-session business logic has not yet been packaged or device-tested.

**Dependency security:** On 2026-11-04, `npm audit --omit=dev` still reported **6 moderate** advisories in Expo's dependency graph (`glob`/`minimatch` and dependent Expo CLI/build tooling), after applying all compatible non-force patches. Do not force the suggested Expo 51 downgrade: it breaks the chosen Expo 58/RN 0.88 setup. Recheck upstream fixes before any internet-exposed deployment.
