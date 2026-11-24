# CodexMobileUI implementation and acceptance

## Release version records

Use `app.json` (`expo.version`) as the release version for Android and Windows.
Keep the root `package.json` and both root version entries in `package-lock.json`
in sync. Increment Android's `expo.android.versionCode` for each release and use
the stable builder to sync the generated Gradle metadata. Verify the APK's
embedded version and version code. For Windows, use the same release version in
the portable package name and verify the EXE's ProductVersion and FileVersion.

## 2026-11-24 Android Visualize readiness hotfix (0.2.2)

- [x] Move native WebView capability injection outside the optional JavaScript block so every successfully completed page advertises support when frame-aware messaging is available. Preserve top-frame-only native message handling and migrate the incremental 0.2.1 patch idempotently.
- [x] Root checks and Gateway build passed; verified compiled Java control flow and the live, existing Visualize HTML endpoint without model inference. No server deployment or Windows packaging required.
- [x] Android 0.2.2 (versionCode 29) Release built using the stable entry, with ARM64, embedded JS, Visualize marker in DEX, v2 test signing and SHA-256 `4D2D3431C546ABC520E5052E16CD6C7935B5D71B20E6097B372ABBBF33F8EE3A`; delivered through CCM.
- [ ] Verify physical phone installation and interaction with the original history component.

## 2026-11-24 Inline Visualize and project welcome (0.2.1)

- [x] Render native Visualize references inline in the shared Web/desktop/Android UI; retain live controls across message refresh and use cached HTML on reopening without persisting widget state.
- [x] Show the selected project name on the new-chat welcome screen.
- [x] Source implementation and browser checks recorded in `0a7ed8d`.
- [x] Deployed Gateway and Web Coordinator/Agent on both hosts; verified new Web process identities, 43 noha deployment file hashes, private HTTPS and JS HTTP 200, and both Gateway health endpoints. App Servers were not restarted.
- [x] Built and delivered Android 0.2.1 (versionCode 28, ARM64, embedded JS, v2 test signature) and Windows 0.2.1 x64 portable ZIP (EXE ProductVersion/FileVersion verified).
- [ ] Physical Android touch/installation acceptance and live native Visualize round-trip on the newly deployed hosts remain separate.

## 2026-11-24 Native conversation controls

- [x] Keep native reasoning summary and explicitly returned display text
  separate, with default-collapsed additional text and no reconstruction.
- [x] Display native sub-agent activity and verify the parent relationship
  before opening a read-only child history.
- [x] Persist the custom permission selection in each client profile and
  compare the real effective native settings when reopening.
- [x] Add the graphical compaction action to the existing context popover,
  with native completion, duplicate prevention and no slash command.
- [x] Use durable native Side Chat attachment relationships, independent
  conversation state, and responsive panel navigation.
- [x] Native disposable-thread verification on 6v/noha: attached context,
  permission inheritance, isolated turns, active-parent fork on 6v, and
  native compaction terminal success.
- [x] Root, Gateway, Web (95 tests) and Desktop checks; headless Chromium
  controls at 1280 and 390 px, with visual verification of the mobile overlay.
- [x] Pushed implementation to main (97e6da3), deployed the Web/Gateway on
  both hosts, verified their local HTTP health without restarting App Server.
- [x] Released Android 0.2.0 (versionCode 27, ARM64, embedded JS, v2 test
  signing) and Windows 0.2.0 x64 (EXE version verified, portable ZIP);
  both verified artifacts were delivered through CCM.
- [ ] Physical Android installation and touch acceptance remain separate.

## 2026-11-24 Conversation experience (source)

- [x] Publish only a clicked, exact native assistant Markdown link; opening a
  conversation no longer copies or transfers any file.
- [x] Add 72-hour immutable private snapshots with 64 KiB reads, 256 MiB
  per-file and 512 MiB cache limits, orphan/expiry cleanup, and no new Quark
  uploads. Re-clicking an available legacy Quark link creates a private
  snapshot.
- [x] Add private HEAD/Range preview URLs, bounded text, images, PDF.js,
  audio/video, and isolated HTML/SVG previews. Android preserves the original
  save filename; browser copies an opaque URL; Electron reveals the host file.
- [x] Keep assistant links inline with only the native label, add responsive
  Markdown/table/code behavior, resizable/persisted desktop sidebar width, and
  the mobile drawer boundary without a desktop separator.
- [x] Add turn-bounded native forks from completed replies and the conversation
  menu, with duplicate protection, list-lag navigation and source retention on
  unconfirmed results.
- [x] Pass root checks, Web tests/build, Desktop tests and a headless
  Web/Electron visual harness at wide and 390 px viewports.
- [ ] Verify system saving on a physical Android device after the next release build.

## 2026-11-21 Windows desktop first implementation

- [x] Reuse the unified React UI through a Windows Electron window, without a
  second client-side chat or a new backend.
- [x] Implement private Coordinator connection settings, native shortcuts,
  context menus, offline retry, Save As and Explorer file reveals.
- [x] Resolve host-local paths directly and remote drive paths through
  verified SMB candidate shares; no arbitrary filesystem read IPC.
- [x] Add automated validation for private origins and host path resolution.
- [ ] Complete native Electron runtime download, package and inspect Windows
  x64 executable on a real Windows desktop.
- [ ] Verify 6v and noha native window launch, full conversation controls,
  downloads, Explorer access / sharing permissions, clipboard attachments,
  window state and keyboard shortcuts.

## 2026-11-16 Gateway deployment and upload cancellation

- [x] Add cooperative cancellation to Android local file reading and per-chunk
  Gateway uploads with a visible progress-card cancel button.
- [x] Allow connection-owned upload cancellation after completion-race;
  reject unknown IDs and caller-provided file paths.
- [x] Separate definite send rejection from unconfirmed submission state.
- [ ] Verify cancel at early/mid/finish stages on a real Android device.


## 2026-11-16 Android launch flash repair (0.1.11)

- [x] Gate first chat frame on local host authorization, session selection,
  cached messages and preferences; retain cached browsing when offline.
- [x] Use one black Android-native and React startup surface and suppress the
  new-chat welcome for persisted threads.
- [x] Store last selected host and per-host real thread ID as navigation-only
  hints; do not replace authoritative App Server history.
- [x] Block premature initial draft creation until first native thread list is
  synchronized; provide explicit no-cache synchronization failure UI.
- [x] Run TypeScript, gateway compilation and contract tests.
- [ ] Verify cold/warm start, offline cache, first-time authorization and
  previous-thread restoration on a physical Android device.

## 2026-11-16 attachment steering (source only)

- [x] Enable image-only, text-plus-image and uploaded file-reference steering
  in native mobile `turn/steer`, with matching bounded Gateway validation.
- [x] Bring Web Bridge and Web composer image steering into alignment with
  per-connection upload ownership checks.
- [x] Keep definite rejections distinct from uncertain acknowledgments and
  avoid prematurely hiding multiple steers sharing an active turn ID.
- [x] Add targeted tests for attachment steering, path rejection and optimistic
  message matching; type-check native, Gateway and Web source.
- [ ] Build/deploy new Gateway and Android clients when explicitly requested;
  verify 6v and noha against a real active native turn and physical device.


## 2026-11-15 Desktop-style activity and branch recovery

- [x] Protect native fork navigation until the server list actually includes
  the newly acknowledged thread, with a local cache fallback.
- [x] Show all commands in a group by default, associate early output deltas
  with the native command ID, and preserve server-observed activity across
  sparse history reads; the native final output remains authoritative.
- [x] Remove the connection-interruption status banner from the chat area.
- [x] Add regression tests for native output, history reconciliation and fork
  list lag. Passing tests do not validate a phone's actual streaming UI.
- [ ] Verify fork navigation and multiple commands with real output on a
  physical Android device, including refresh during an active turn.

## 2026-11-14 response rendering and file publication (source only)

- [x] Port CCM's local Quark desktop helper into the Gateway for files above
  12 MiB; confirm FINISH/100%/matching size before reporting success, persist
  failures, and do not create snapshots or share links for large files.
- [x] Bundle the Python helper in the compiled Gateway and Host-only package;
  mock success/failure/refresh tests do not touch the user's Quark account.
- [ ] Confirm a real Quark transfer only with an explicitly selected test file
  and deployment approval; noha requires its own logged-in desktop client.

- [x] Native plan preview/full-screen Markdown component, shared response/
  summary Markdown and LaTeX component, and stable block-math segmentation.
- [x] Attachment and private publication download byte/percentage UI.
- [x] Gateway-owned, native-thread-verified file snapshots for any local-drive
  regular file, independent of cwd/extension; missing files report unavailable
  on link activation. Raw absolute paths in normal prose are not interpreted.
- [x] Android converts native assistant Markdown file links into inline clickable
  labels with authenticated file download/preview and no duplicate file card.
- [x] Gateway removes native `fileChange` diffs before mobile relay.
- [ ] Build the APK only on explicit user request and test on physical Android:
  math layout, scrolling, file previews, reconnect and long-content performance.
- [ ] Deploy and verify the Gateway on 6v/noha only on explicit release request.
- [ ] Independent authenticated end-to-end test with actual assistant-generated
  Windows file links and server-side snapshotted file bytes.

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
- [x] 6v Gateway moved to a normal-user Windows scheduled task (`CodexMobileUI Gateway`) after confirming CCM sandbox inheritance. New Gateway token checked as `TokenIsRestricted=0`, normal App Server unchanged, listener 48888 healthy. New-host task registration and on-device behavior require separate validation.
- [x] noha redundant `host-runtime` removed in favor of root-only Host deployment, preserving private OAuth config/state and locally identical runtime. App Server and Gateway started from root with `TokenIsRestricted=0`, local ports 45891/48888 healthy. noha no longer carries Android/Web development sources or their npm dependencies.
- [ ] noha post-migration authenticated public Funnel readback and physical Android acceptance.
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

- [x] Unified multi-computer Android sidebar groups projects per host, mixes recent threads across enrolled machines, provides host filtering and host labels, and persists drawer expand/collapse state.
- [x] Passive host-scoped metadata sync retains offline project/normal/archived thread caches, while cross-host selection waits for a matching target session; no passive thread resume or turn submission.
- [ ] Physical-device check with 6v and noha concurrently authorized: filtering without switching, selecting same-named projects on different hosts, switching to a foreign thread, offline cached history, reconnection, project actions and new-chat host picker.

- [x] Native paginated threads/projects, local-only blank chats, first-send sequence, draft persistence and ambiguous-submission guard.
- [x] Unique projectless workspace preparation by authenticated Gateway/native filesystem RPC.
- [x] Native project move and rename; bounded ephemeral automatic title worker.
- [x] First-turn-acknowledged title generation, immediate acknowledged title UI/cache update, bounded retry and stale-list protection; added isolated title-generation and race tests.
- [ ] Verify automatic title appearance and failure/reconnect retry timing on a physical Android device.
- [x] Gateway OAuth PKCE, authenticated WSS and restricted native RPC relay.
- [x] Prior double-host native API tests used disposable project-assigned threads, plus filesystem creation.
- [x] Android visual-first interface integrated as a single native source: animated sidebar, nested projects, session menu, model/effort selector, composer animation, icon assets and local visual editor.
- [x] Sidebar native pull-to-refresh wired to authenticated thread/project synchronization, including archived threads and active conversation readback. Offline swipes request reconnection; concurrent gestures are deduplicated.
- [ ] Verify sidebar pull distance, spinner placement, offline reconnection and refreshed conversation/project ordering on a physical Android device.
- [x] Connected UI actions to host-scoped OAuth/session state and native thread/project APIs for rename, pin (local), archive/unarchive, delete, move, first send and project creation; server model/effort choices are requested from native model/list, while permission choices now use native permissionProfile/list and validated thread/turn profile overrides, with a Full Access warning and a custom config.toml inheritance option.
- [x] Removed the separate local simulated conversation data model and fake replies; visually matched native screen components now render real message IDs and content.
- [x] Updated Android app identity to 0.1.6 / versionCode 8 while preserving `dev.codexmobileui.app`, `codexmobileui` OAuth scheme, the previous signing key and independent backend/Gateway. Native Expo prebuild completed on 6v.
- [ ] Physical Android validation of model catalog, effort/speed selection, new chat/turn, project creation/move, archive/unarchive, speech recognition and cross-host switching.
- [ ] Physical Android validation of the new profile, empty project list, first chat/turn, streaming, offline recovery, title worker, rename and file permissions.

## Real rule/config file synchronization (2026-11-13)

- Added authenticated host-owned reads/writes for the dedicated home
  `config.toml`, global AGENTS instructions, and native-project-root AGENTS
  instructions, with active override selection, absent-file creation, and
  optimistic concurrency protection.
- Settings shows global rules plus `config.toml`; project rules opens the
  corresponding native root file (asks which root for multi-root projects).
- Added host-file unit tests for global/config save, native project resolution,
  override precedence, stale edits and invalid requests; native project/read
  response shape was verified read-only on 6v.
- Still requires authenticated on-device read/save verification and a new
  Android APK before the installed phone can use these controls. No Desktop
  profile files were edited.

## Android delivery and future stages

- [x] 0.1.5 / versionCode 7 Android Release delivered to **夸克上传文件** on 2026-11-12. Verified artifact: `CodexMobileUI-0.1.5-release-arm64.apk` (30,016,591 bytes; SHA-256 `324B6CF43A4A9791E3C2BFB509514A218E5CE28303EC565770731FB901F84896`; test signing, not production signing). CCM reported FINISH/100% and matching remote size. Full suite: 38 core + 22 host + 5 build tests passed.
- [x] Built, verified and delivered 0.1.6 / versionCode 8 ARM64 Release from the integrated native UI on 2026-11-13. `CodexMobileUI-0.1.6-release-arm64.apk`: 31,675,022 bytes, SHA-256 `AAE25277CA7981279E025602C0FEE4047584A074B53B31929101FEA8E99BC2DE`; package `dev.codexmobileui.app`, same test signing certificate as 0.1.5, offline JS bundle, 21 ARM64 libraries and no other ABI. Gradle 716 tasks (173 executed), Quark FINISH/100% confirmed.
- [x] Recompiled and safely restarted only the 6v project-owned Gateway, preserving the 8443 Funnel mapping and private 45891 native App Server. Verified health plus authenticated public PKCE/WSS thread/list and thread/read after restart; read-only native model/list returned eight model entries and the default effort catalog. Disposable native project create/update/delete succeeded and was cleaned up.
- [ ] Native approval and user-question cards, Plan controls, stop/steering and recovery. The composer now uses native persisted Goal RPCs and true goal status notifications, including blocked-goal Continue, while Plan mode is wired through `turn/start` collaboration mode. Lifecycle mutations and behavior still need private-server/physical Android acceptance.
- [ ] Complete attachment lifecycle acceptance and cleanup policy for both project and projectless conversations. Android source now includes server-confirmed upload progress, native `localImage` parsing, in-chat photo/file cards, photo viewer and system file preview, plus authenticated 64 KiB chunk reads restricted to generated upload files. Host deployment, stale-file cleanup and physical Android verification remain outstanding.
- [ ] Notifications, server-backed full-text search, actual AGENTS editor, host-scoped cross-conversation references and long-thread paging. Visual local search/unread markers are implemented.
- [ ] Confirm Android keyboard, Markdown, math, diagnostics and accessibility on real hardware.

A build or Gateway health check is not equivalent to successful Android authentication or model inference. Keep external desktop processes and profile data intact throughout the rollout.
