# CodexMobileUI implementation and acceptance

## Independent Windows backend and private profile

- [x] Native backend endpoint and Gateway target made MobileUI-only: loopback 45891 and 48888.
- [x] Host-owned launcher separates native App Server, Gateway and login operations. It discovers verified Desktop-distributed kernel files, copies a fingerprinted runtime and refuses unknown listener/process takeovers.
- [x] Private persistent `CODEX_HOME=%LOCALAPPDATA%\CodexMobileUI\CodexHome`. No copying user profile, projects, sessions or credentials; no Desktop lifecycle control.
- [x] Android conversation caches receive a distinct profile namespace without deleting old local data.
- [x] Removed defunct compatibility launcher/proxy source and replaced source contracts; documentation updated.
- [x] 6v private App Server started from a fingerprinted runtime copy; independent data home created; owner and readiness checks passed under restricted CCM.
- [x] 6v native initialize, project/list and thread/list: private counts 0 projects, 0 threads; account/read reports no private model login.
- [x] 6v temporary isolated OAuth PKCE Gateway authenticated and forwarded thread/list to the private backend without touching the installed Gateway or Funnel.
- [ ] noha private backend startup and both hosts' clean shutdown/restart/ownership checks.
- [ ] Dedicated Codex account authentication into the empty home and a successful, explicitly approved real model turn on each host.
- [ ] Private Gateway `.env` switched safely and OAuth/WSS relaying verified with the new backend. Do not alter Funnel or unrelated running services until backend validated.
- [ ] New Android build with private cache scope installed and tested. Previous 0.1.4 APK is not proof of the new topology.
- [ ] Explicitly test concurrent normal Desktop work and MobileUI, verifying data-home and writer-lock separation.
- [ ] Native project creation / discovery UX for an initially empty isolated profile, and real end-to-end project moves.
- [ ] Confirm file access/working directories do not unexpectedly overlap files actively edited by the desktop application.

## Native conversation functionality already in source

- [x] Native paginated threads/projects, local-only blank chats, first-send sequence, draft persistence and ambiguous-submission guard.
- [x] Unique projectless workspace preparation by authenticated Gateway/native filesystem RPC.
- [x] Native project move and rename; bounded ephemeral automatic title worker.
- [x] Gateway OAuth PKCE, authenticated WSS and restricted native RPC relay.
- [x] Prior double-host native API tests used disposable project-assigned threads, plus filesystem creation.
- [ ] Physical Android validation of the new profile, empty project list, first chat/turn, streaming, offline recovery, title worker, rename and file permissions.

## Android delivery and future stages

- Last previously delivered test Release is 0.1.4 / versionCode 6, signed for testing and uploaded to Quark. It predates the private cache namespace and independent launcher implementation.
- [ ] Build and verify the 0.1.5 / versionCode 7 Android Release and upload it after host-side validation; check package identity, embedded JS, ARM64 binaries and signature.
- [ ] Native approval and user-question cards, model/effort/Plan controls, stop/steering and recovery.
- [ ] A common upload/download/preview implementation for both project and projectless conversations, with path authorization and progress.
- [ ] Search/unread, notifications, AGENTS editor, host-scoped cross-conversation references and long-thread paging.
- [ ] Confirm Android keyboard, Markdown, math, diagnostics and accessibility on real hardware.

A build or Gateway health check is not equivalent to successful Android authentication or model inference. Keep external desktop processes and profile data intact throughout the rollout.
