# CodexMobileUI

An open-source-ready, **personal-use Android client** for the existing Codex App Server used by Codex Desktop. Chat sessions stay authoritative on the host PC; the phone caches messages and drafts.

**Status (2026-11-04): Stage 1 implementation in progress.** The Android application, OAuth PKCE flow, per-host gateway, native chat view, SQLite snapshot cache, and protocol tests have been implemented. TypeScript checks and gateway integration tests pass; a development-mode Android JS bundle was generated with Expo Metro. Two **read-only** probes succeeded against the actual 6v shared Codex App Server: direct `thread/list` and a full temporary localhost OAuth PKCE → authenticated WSS gateway → `thread/list` sequence. **No Android APK has been built or tested on a device, no production gateway is deployed, and mobile OAuth/live chat remain unverified.** Do not interpret this as a supported, fully operational client.

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
- Discover actual threads via Codex `thread/list`, open with `thread/resume`, read committed turns via `thread/read`, and send user turns with `turn/start`.
- Stream agent text deltas when delivered by App Server and reconcile final turn history rather than building a second chat engine. `threadId`, `turnId` and `itemId` are used to deduplicate messages.
- Local SQLite snapshots of seen messages and threads; offline drafts are never automatically sent on reconnection.
- Per-host OAuth 2.0 authorization code + PKCE S256, short-lived access tokens, rotating refresh tokens, token revocation, local browser consent with a host-specific secret.
- Unit and integration tests for parser, OAuth, WSS authorization and JSON-RPC relay.

## Not implemented yet

The following are **planned**, not supported by the current build: verified real-host and Android-device integration; authenticated file upload/download/preview (5 MiB/file and individual progress); original mobile URI+SHA-256 attachment tracking; native local notifications; approval and user-question cards; model/effort, permissions and Plan Mode controls; search/unread; global/project AGENTS.md editing; usage/compact state; historical-turn fork; Worktree B, Goal and auxiliary controls. Native Markdown math rendering must be tested with a real Android build and long transcripts.

## Development on Windows

**Shared launchers (source added; live Windows behavior unverified):** `Start-CodexMobile.cmd` hot-attaches to an already healthy localhost 45789/45790 shared stack or starts an independently owned copy, then launches this checkout's authenticated Gateway on localhost 48888. `Stop-CodexMobile.cmd` stops only owned processes. The AOI-style Desktop entry `Start-Codex-Shared-Proxy.cmd` and independent `shared-start.cmd` / `shared-stop.cmd` are also included. Read [docs/shared-launcher.md](docs/shared-launcher.md) before use, especially its ownership and network-exposure cautions. The scripts do not call AOI at runtime.

Requires Node.js 24 and npm. For an actual Android APK build, install/configure Android Studio SDK, Java toolchain, and optionally adb; Expo Go alone cannot validate all native dependencies. Use a **development build**.

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
- `npm run probe:authenticated`: after building the gateway, creates a temporary localhost-only OAuth grant and verifies an authenticated `thread/list` across the gateway to the existing shared app server, without changing the shared service or printing conversations.
- `npm run export:android`: JS bundle export, **not an APK**.
- Follow [docs/architecture.md](docs/architecture.md), [docs/roadmap.md](docs/roadmap.md), [SECURITY.md](SECURITY.md), and [AGENTS.md](AGENTS.md).
- Code and documentation are designed for public repository visibility: never commit local secrets, site-specific credentials, signature keys, OAuth state, downloaded private files, or real chat logs.

**Known validation gap:** npm install in the restricted 6v environment required `--ignore-scripts`. That skips the native Markdown vendor-assets postinstall (including math assets). A development-mode JS bundle export passed, but production Hermes bytecode export failed with `spawn EPERM` due to process restrictions. Proper native dependency installation/Android build must run in a suitable environment before considering rich Markdown/LaTeX supported.

**Dependency security:** On 2026-11-04, `npm audit --omit=dev` still reported **6 moderate** advisories in Expo's dependency graph (`glob`/`minimatch` and dependent Expo CLI/build tooling), after applying all compatible non-force patches. Do not force the suggested Expo 51 downgrade: it breaks the chosen Expo 58/RN 0.88 setup. Recheck upstream fixes before any internet-exposed deployment.
