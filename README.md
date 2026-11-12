# CodexMobileUI

## Web 工作台（2026-11-12）

- `web/` 是独立的 React/TypeScript/Vite 网页视觉原型，采用 ChatGPT 风格布局，包含响应式侧边栏、电脑和项目筛选、搜索、主题切换、示例执行卡片以及本地输入交互。
- 当前电脑、项目、会话均为明确标记的演示数据。**尚未连接任何 Codex App Server、Gateway 或 Tailscale**，开发预览仅监听本机 `127.0.0.1:4173`。
- 详细用法与后续接入边界见 `web/README.md`。已有 Android、Gateway、App Server、OAuth 和 Funnel 配置均未修改。

Personal Android front end for a **dedicated Codex App Server** running on a Windows host. The Android app uses native Codex thread/turn/project RPCs through a narrowly allowlisted OAuth PKCE Gateway; SQLite holds local caches and unsent drafts.

## Current status (2026-11-13; Android 0.1.6 / versionCode 8 native UI integration)

- The Windows host source now implements an independently managed App Server and a private `CODEX_HOME`. It draws executables from the installed Codex Desktop runtime but **does not launch the Desktop app or share its live process**.
- Default private data home: `%LOCALAPPDATA%\CodexMobileUI\CodexHome`. The everyday Desktop profile `%USERPROFILE%\.codex` is untouched. No existing sessions, projects, configuration or model credentials are copied.
- Direct native backend: `ws://127.0.0.1:45891`, Gateway: `127.0.0.1:48888`, owner-authorized HTTPS Funnel: port `8443` -> Gateway. Backend is loopback-only.
- On **6v**, the private App Server is running from a separately copied Codex runtime with its own logged-in profile; native account/read returns **account_present=true**. The independently owned Gateway is healthy at 48888, forwarding only to private App Server 45891. Real public HTTPS Funnel 8443 passed OAuth wrong-secret retry, PKCE token exchange, authenticated WSS, thread/list and thread/read. One real model turn was completed and its user/assistant messages were read back from the private profile and again through the authenticated public Funnel. This proves host-side inference and public readback, **not a physical Android UI test**.
- The **6v Android 0.1.5 ARM64 Release test APK** was successfully built on 2026-11-12 after approving the fixed Android build command via CCM. Gradle completed **605 tasks (60 executed, 545 up-to-date)** in 20m 30s, including native CMake/Ninja, Metro bundle and R8 optimization. The checked artifact is `CodexMobileUI-0.1.5-release-arm64.apk` (versionCode 7, 30,016,591 bytes, SHA-256 `324B6CF43A4A9791E3C2BFB509514A218E5CE28303EC565770731FB901F84896`). Identity `dev.codexmobileui.app`, embedded JS, 20 ARM64 libraries and v2 test signature passed independent verification. CCM uploaded it to **夸克上传文件** with **FINISH / 100%** and matching size. Core 38, host 22 and build 5 tests passed, as did TypeScript checks and Gateway compilation.
- The current **0.1.6 / versionCode 8 source** incorporates the full Android visual layout, animations, sidebar, project/chat menus, visual tokens, SVG icons, app icon, on-device speech transcription, account page and composer. The single native app entry `App.tsx` now uses the authenticated `useCodexSession` and real Codex server IDs/messages/projects. No duplicate simulated conversation state or demo reply generator remains. Native Android prebuild regenerated `dev.codexmobileui.app` and the `codexmobileui` callback while retaining the exact previous test signing keystore. 0.1.6 requires its own completed Release build and physical Android acceptance before it can replace the delivered 0.1.5.
- **noha is paused by owner request.** Its Gateway, native backend and private login were not modified in this round. Noha's private backend cutover still requires its own controlled setup and validation.
- **Remaining acceptance:** install/use the new APK on a physical Android phone, exercise login, first-send, streaming, projects, title generation, filesystem permissions, offline recovery and concurrent Desktop behavior. No Codex Desktop, AOI or Funnel configuration was modified by this build.

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
- The Android UI takes its visual dimensions and interaction patterns from `src/ui/ChatSidebar.tsx`, `ChatView.tsx`, `AccountScreen.tsx`, `ChatSetupPicker.tsx`, `ConversationMenu.tsx` and `visual-tokens.json`. Use `docs/visual-workbench.md` for live local style adjustments.
- The sidebar and conversation menu use native archive/unarchive/delete, project create/rename/delete, conversation naming and project assignment. The local-only new-chat draft becomes a native thread on first send. The model/effort controls request the real server model catalog and submit bounded options to `turn/start`. User-visible server changes wait for an acknowledged RPC rather than altering a simulated repository.
- Pinned items, unread markers and rule **notes** are host-scoped phone preferences in a separate SQLite database. The rule note editor is not a server AGENTS editor. Permission labels cannot grant Full Access or bypass host approvals. File upload, scheduled task execution and real-time voice calls are not connected to the native Gateway yet and must display a truthful unavailable state.

Not yet validated on a physical device: first-send/project/move/title flows, on-phone authorization of the private host, offline recovery, file upload/download/preview, Android keyboard behavior and new launch/stop lifecycle. See `docs/roadmap.md`.

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
