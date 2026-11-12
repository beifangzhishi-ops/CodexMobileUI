# CodexMobileUI implementation and acceptance

## Browser workspace

- [x] Standalone `web/` React/TypeScript/Vite application with ChatGPT-like responsive layout, animated desktop sidebar, mobile drawer and theme switching.
- [x] Fictional multi-host/project conversations, recent/search lists, sample unread/running states, activity details and local-only composer/attachment UI.
- [x] Web strict TypeScript validation and production build pass independently of Android.
- [ ] Actual desktop/mobile browser screenshot and interactive acceptance.
- [ ] Authenticated web coordinator, real device enrollment, private Tailscale Serve deployment and per-host message routing.
- [ ] Verify true thread restoration, streaming, stop, approvals, disconnect handling and host isolation.

## Independent Windows backend and private profile

- [x] Native backend endpoint and Gateway target made MobileUI-only: loopback 45891 and 48888.
- [x] Host-owned launcher separates native App Server, Gateway and login operations. It discovers verified Desktop-distributed kernel files, copies a fingerprinted runtime and refuses unknown listener/process takeovers.
- [x] Private persistent `CODEX_HOME=%LOCALAPPDATA%\CodexMobileUI\CodexHome`. No copying user profile, projects, sessions or credentials; no Desktop lifecycle control.
- [x] Android conversation caches receive a distinct profile namespace without deleting old local data.
- [x] Removed defunct compatibility launcher/proxy source and replaced source contracts; documentation updated.
- [x] 6v private App Server started from a fingerprinted runtime copy; independent data home created; owner and readiness checks passed under restricted CCM.
- [x] 6v native initialize, project/list and thread/list confirmed the private profile initially started empty. A separate real model test subsequently created one native thread with a persisted user message and assistant reply.
- [x] 6v independent Codex device login confirmed by native account/read (account_present=true) and the presence of authentication data exclusively in the private home; no Desktop credential import.
- [x] 6v temporary isolated OAuth PKCE Gateway authenticated and forwarded thread/list to the private backend without touching the installed Gateway or Funnel.
- [ ] noha private backend startup and both hosts' clean shutdown/restart/ownership checks.
- [x] 6v independently authenticated native Codex model turn completed; private thread/read confirmed user and assistant messages, and the real HTTPS Funnel 8443 OAuth/WSS relay retrieved them with thread/list and thread/read.
- [ ] noha dedicated Codex account login and real model turns, once owner resumes noha work.
- [x] 6v existing Gateway private `.env` upstream switched to `ws://127.0.0.1:45891` while preserving OAuth secret, origin, callback and listener. Gateway started on original 48888 and public HTTPS Funnel 8443 verified OAuth/PKCE, authenticated WSS and native `thread/list` against private backend.
- [ ] noha dedicated App Server startup, private account authorization and safe Gateway switch (paused by owner). Leave noha's existing Gateway untouched until its dedicated backend, login and process ownership have been verified.
- [x] Android 0.1.5 / versionCode 7 ARM64 Release test APK built and verified on 6v using private Gradle user cache and a short-path native build checkout. Signed, embedded-JS bundle, ARM64 libraries, actual Android package identity, source SHA-256 and delivery to Quark FINISH/100% verified.
- [ ] Install and test the current APK on Android; old on-device conversation cache must not be treated as independent backend history.
- [ ] Explicitly test concurrent normal Desktop work and MobileUI, verifying data-home and writer-lock separation.
- [ ] Device verification of project creation and real project moves for an initially empty isolated profile; UI and narrowly allowlisted native RPCs are implemented.
- [ ] Confirm file access/working directories do not unexpectedly overlap files actively edited by the desktop application.

## Native conversation functionality already in source

- [x] Native paginated threads/projects, local-only blank chats, first-send sequence, draft persistence and ambiguous-submission guard.
- [x] Unique projectless workspace preparation by authenticated Gateway/native filesystem RPC.
- [x] Native project move and rename; bounded ephemeral automatic title worker.
- [x] Gateway OAuth PKCE, authenticated WSS and restricted native RPC relay.
- [x] Prior double-host native API tests used disposable project-assigned threads, plus filesystem creation.
- [x] Android visual-first interface integrated as a single native source: animated sidebar, nested projects, session menu, model/effort selector, composer animation, icon assets and local visual editor.
- [x] Connected UI actions to host-scoped OAuth/session state and native thread/project APIs for rename, pin (local), archive/unarchive, delete, move, first send and project creation; server model/effort choices are requested from native model/list, while Full Access cannot be set from a mobile UI control.
- [x] Removed the separate local simulated conversation data model and fake replies; visually matched native screen components now render real message IDs and content.
- [x] Updated Android app identity to 0.1.6 / versionCode 8 while preserving `dev.codexmobileui.app`, `codexmobileui` OAuth scheme, the previous signing key and independent backend/Gateway. Native Expo prebuild completed on 6v.
- [ ] Physical Android validation of model catalog, effort/speed selection, new chat/turn, project creation/move, archive/unarchive, speech recognition and cross-host switching.
- [ ] Physical Android validation of the new profile, empty project list, first chat/turn, streaming, offline recovery, title worker, rename and file permissions.

## Android delivery and future stages

- [x] 0.1.5 / versionCode 7 Android Release delivered to **夸克上传文件** on 2026-11-12. Verified artifact: `CodexMobileUI-0.1.5-release-arm64.apk` (30,016,591 bytes; SHA-256 `324B6CF43A4A9791E3C2BFB509514A218E5CE28303EC565770731FB901F84896`; test signing, not production signing). CCM reported FINISH/100% and matching remote size. Full suite: 38 core + 22 host + 5 build tests passed.
- [ ] Build, verify and deliver 0.1.6 / versionCode 8 ARM64 Release from the integrated native UI, preserving upgrade signing continuity, bundled JS, ARM64-only libraries and validated OAuth identity.
- [ ] Native approval and user-question cards, Plan controls, stop/steering and recovery. Model/effort/speed controls are wired to native model/list and turn/start but still need on-device validation.
- [ ] A common upload/download/preview implementation for both project and projectless conversations, with path authorization and progress.
- [ ] Notifications, server-backed full-text search, actual AGENTS editor, host-scoped cross-conversation references and long-thread paging. Visual local search/unread markers are implemented.
- [ ] Confirm Android keyboard, Markdown, math, diagnostics and accessibility on real hardware.

A build or Gateway health check is not equivalent to successful Android authentication or model inference. Keep external desktop processes and profile data intact throughout the rollout.
