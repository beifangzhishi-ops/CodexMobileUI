# CodexMobileUI

## Web 工作台（2026-11-12）

- `web/` 是独立的 React/TypeScript/Vite 网页视觉原型，采用 ChatGPT 风格布局，包含响应式侧边栏、电脑和项目筛选、搜索、主题切换、示例执行卡片以及本地输入交互。
- 当前电脑、项目、会话均为明确标记的演示数据。**尚未连接任何 Codex App Server、Gateway 或 Tailscale**，开发预览仅监听本机 `127.0.0.1:4173`。
- 详细用法与后续接入边界见 `web/README.md`。已有 Android、Gateway、App Server、OAuth 和 Funnel 配置均未修改。

Personal Android front end for a **dedicated Codex App Server** running on a Windows host. The Android app uses native Codex thread/turn/project RPCs through a narrowly allowlisted OAuth PKCE Gateway; SQLite holds local caches and unsent drafts.

## Current status (2026-11-11; development target 0.1.5 / Android versionCode 7)

- The Windows host source now implements an independently managed App Server and a private `CODEX_HOME`. It draws executables from the installed Codex Desktop runtime but **does not launch the Desktop app or share its live process**.
- Default private data home: `%LOCALAPPDATA%\CodexMobileUI\CodexHome`. The everyday Desktop profile `%USERPROFILE%\.codex` is untouched. No existing sessions, projects, configuration or model credentials are copied.
- Direct native backend: `ws://127.0.0.1:45891`, Gateway: `127.0.0.1:48888`, owner-authorized HTTPS Funnel: port `8443` -> Gateway. Backend is loopback-only.
- On **6v**, the private App Server is running from the independently copied kernel and native account/read returns **account_present=true**. The owner check and /readyz pass; native initialize, thread/list and project/list report an empty independent catalog (0 conversations, 0 projects). The existing private Gateway upstream was updated to 45891 (no other .env keys changed), and Gateway started at its original loopback port 48888 with owner and health both True. The real public HTTPS 8443 Funnel passed OAuth wrong-key retry, PKCE token exchange and authenticated WSS thread/list via the independent backend. This verifies real public read-only transport, not a model turn or physical phone UI.
- On **noha**, the live Gateway at 48888 remains healthy and was deliberately left unchanged; the current checkout does not identify it as an owned process. Its new private backend is not running: first creation of its isolated CODEX_HOME was denied by the workspace sandbox, and a narrowly scoped start approval is pending. Its Gateway cannot safely be repointed before backend startup, independent account authorization and confirmed Gateway process ownership.
- Windows scripts, mobile cache scope and documentation are updated. **Real model turns, noha cutover, Android 0.1.5 packaging and physical-device acceptance remain pending.** Neither Codex Desktop data/processes nor the existing Funnel routes were modified.
- Last previously verified distributed artifact: `CodexMobileUI-0.1.4-release-arm64.apk` (versionCode 6, test signing certificate; 30,016,839 bytes; SHA-256 `98B44344894AE65B2F42DB6B4114CD8B2CE4983DE04069C87BE5A38AC1353178`), uploaded to Quark with FINISH/100%. **That prior APK does not include the new isolated-client cache namespace or current host-launcher changes**.

## Architecture

```text
Android client (HTTPS/WSS + OAuth)
          |
    Tailscale Funnel :8443
          |
   MobileUI Gateway 127.0.0.1:48888
          |
  native Codex App Server 127.0.0.1:45891
          | CODEX_HOME=%LOCALAPPDATA%\CodexMobileUI\CodexHome
          | codex.exe copied from a verified Desktop installation
          |
    MobileUI-only projects and session history
```

The Desktop app and its project/chat database remain independent and usable concurrently. A project working directory selected by MobileUI can still be an ordinary host directory; data-home separation alone is **not** operating-system filesystem isolation.

Gateway OAuth is independent of native Codex model login. For model requests, authenticate the private home using `Login-CodexMobile.cmd`; do not copy another profile's `auth.json`. After that, authorize Android to the Gateway using the host's existing private OAuth consent flow.

## Features implemented in source

- Native `thread/list`, `thread/read`, `thread/resume`, `turn/start`, stream events and completion reconciliation; no second inference engine.
- Project listing through `project/list`, native project IDs and real thread moves via `thread/metadata/update`. A newly isolated data home starts with no project metadata until projects are created or otherwise configured.
- Local-only blank chats; first real message creates its project thread or prepares a unique projectless workspace via native `fs/createDirectory`, then starts the turn. Ambiguous RPC results are not automatically retried.
- A bounded ephemeral title worker and native `thread/name/set`, manual renames, host-scoped Android conversation caches and independently serialized drafts.
- Host-specific OAuth PKCE/WSS Gateway, restricted RPCs, sanitized request diagnostics and Android diagnostic export.

Not yet device-validated: the current first-send/project/move/title flows, private-home model authentication, noha mobile login, offline recovery, file upload/download/preview, Android keyboard behavior and new launch/stop lifecycle. See `docs/roadmap.md`.

## Windows operations

- `Start-CodexMobile.cmd`: start the dedicated backend then Gateway.
- `Stop-CodexMobile.cmd`: stop only MobileUI's owned Gateway/backend.
- `Login-CodexMobile.cmd`: separate native Codex login into the private data home.
- `scripts/mobile-launcher.ps1`: explicit start/stop/status orchestration.
- `scripts/mobile-app-server.ps1`: private backend ownership, runtime selection and health. Under restricted CCM, ownership requires private kernel path + PID file birth time + verified loopback listener instead of unavailable WMI command-line inspection.
- `scripts/probe-private-backend.mjs` / `npm.cmd run probe:private`: read-only local initialize, project/thread counts and native account-presence check without displaying user records.
- `scripts/gateway-only.ps1`: authenticated Gateway lifecycle. Its private `.env` must specify `CODEX_APP_SERVER_WS=ws://127.0.0.1:45891` before a new Gateway is started.
- `scripts/build-android-stable.ps1`: fixed Android build entry with version/signature/bundle checks. It writes Gradle cache and temporary files only under this checkout's ignored `.tmp/gradle-user` and `.tmp/build-temp`, reads the installed Gradle distribution without locking its global cache, and keeps the separate short-path native build checkout for incremental CMake/Gradle outputs.

For step-by-step Windows operations and safety boundaries, read `docs/mobile-host.md`. For network and OAuth routing, read `docs/funnel-deployment.md`. For design and scope, read `docs/architecture.md` and `docs/roadmap.md`.

## Development and security

Both Windows hosts maintain the same source repository and commit, with separate private `.env`, `.state`, `.runtime`, data homes, logs, keys and build caches. The repository is suitable for public visibility; never commit host URLs, access tokens, login states, key material or chat history.

Run `npm.cmd run check` and `npm.cmd run build:gateway` in the checkout, and validate the real process, model auth, OAuth and device separately. Expo Release packaging must embed JS and be independently verified before uploading. There is no configured Git remote by default; do not create one without authorization.

The owner's original Desktop environment is needed for work during development. Never terminate or modify it as a MobileUI setup or troubleshooting shortcut.
