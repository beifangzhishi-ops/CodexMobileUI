# CodexMobileUI repository rules

## Current UI direction (owner approved 2026-11-21)

- Windows desktop shell lives in `desktop/` and loads the existing private
  Web Coordinator using Electron; it must reuse `web/src/` and never launch,
  stop, or attach to the unrelated Codex Desktop user interface. It owns only
  its per-user UI settings and browser-window lifecycle, not thread state or
  a new App Server. Keep Electron sandbox, context isolation, Node isolation,
  validated private Coordinator origin, and bounded origin-checked native IPC.
  File "open" means reveal an existing path in Explorer, not executing binaries.
- Build desktop Windows releases only in the ignored `.tmp/desktop-release`
  area. Noha remains host-only in its CodexMobileUI project root; do not copy
  Electron source or binaries into its host deployment. A future end-user
  installation belongs outside that root.

- Android and browser must render the same responsive React chat UI from
  `web/src/`; the Android `App.tsx` is only an Expo/WebView container for
  Tailnet discovery, navigation and OS file saving. Do not re-introduce the
  old parallel Android chat, sidebar, approval or settings UI.
- Keep feature/state logic shared across clients. Platform-specific
  presentation or input triggers (touch, pointer, keyboard) may adapt
  independently without inventing different native RPC semantics.
- Previous native-only UI checks are historical and must not gate the new
  shared frontend. Retain host permission, identity, attachment and file
  publication boundaries and verify physical Android behavior before release.

## Architecture and authority
- CodexMobileUI is a shared responsive React client (browser and Android WebView) backed by independent MobileUI-owned Windows Codex App Servers on 6v and noha. Real thread, project and turn state belongs to each server. Android SQLite only remembers the private coordinator and discovered host roster; it never owns chats, drafts, or inference.
- Isolation is mandatory: the backend process inherits `CODEX_HOME=%LOCALAPPDATA%\CodexMobileUI\CodexHome`. Never copy another profile's sessions, projects, config, auth or writer locks into it. Never modify the default `.codex`, globally set `CODEX_HOME`, or reconfigure unrelated processes.
- Discover a complete Codex runtime exclusively from the installed Desktop package or its managed cache. Fingerprint and copy all required executables/libraries into `.runtime/mobile`; do not execute the Desktop UI, use IDE/CLI alternatives, or overwrite active copies.
- Each native backend listens only on `ws://127.0.0.1:45891`. Each private Gateway listens on loopback and its Tailscale IPv4 at `48889`; the 6v Web Coordinator listens on `127.0.0.1:4190`, reached through private Tailscale HTTPS Serve on 4190, and noha runs a private Web Agent at `127.0.0.1:4191`. Backend and Gateway have independent PID ownership checks. Never reopen the retired public Funnel or port 48888.
- `Start-CodexMobile.cmd` starts the owned backend first and Gateway second. `Stop-CodexMobile.cmd` stops Gateway first, then the owned backend. Neither adopts, stops or restarts unverified processes. `Login-CodexMobile.cmd` authenticates the new Codex home interactively; never copy credentials.
- Gateway startup must be delegated to the Windows user-owned `CodexMobileUI Gateway` Task Scheduler task (interactive logon, Limited run level), installed with `scripts/install-gateway-task.ps1`. `scripts/gateway-only.ps1 -Action start` triggers this task; `-Action task-run` is only its internal entry. Do not directly launch the long-lived Gateway with `Start-Process` inside a CCM sandbox, since the child inherits CCM's restricted token. Task registration/start from CCM requires explicit approved escalation; ordinary Windows user startup does not require administrator rights.
- Android `src/storage/database.ts` keeps only the private coordinator and discovered hosts; it must preserve the existing SQLite database and the `mobile_network` row across upgrades. All chat and navigation state comes from `web/src/`. No Android Gateway OAuth is needed over the approved private Tailnet.
- The owner needs Codex Desktop for work throughout development. Never stop or restart Desktop or other clients for MobileUI tests. Do not migrate old history, project metadata or credentials without explicit owner approval.

## Source and protocol rules

- Cross-host path mapping uses the per-host C-drive SMB share IP + name, stored
  privately by the Coordinator. User-authored absolute paths are resolved on
  the Codex destination host by checking both drives; ambiguous matches must
  not be silently rewritten or sent. Native desktop File attachments may use
  a verified local path or matching UNC without uploading bytes. Do not
  rewrite assistant prose, commands, code fences or native Codex history.
  Only explicitly clickable assistant file references receive a viewer-local
  path projection. Display-only turn/path overlays never modify inference.
- **No client-authored prompts for attachments (project-wide preference).** Android, Web, and Gateway must not prepend, append, or silently inject instructional prose into the user's turn merely because an image or file is attached. Preserve exactly the user's own message text. Send images as native Codex App Server image input parts (`localImage` for host-local uploaded images), including image-only messages with no synthetic text prompt. For ordinary files, upload to the chosen host and reference their real host-local paths using the **verified Codex Desktop convention** (currently `# Files mentioned by the user:` / `## My request for Codex:`), not MobileUI-specific instructions such as "please read the attached file". Do not invent a file-input RPC shape or embed file contents as replacement prompts. Keep attachment cards and path-hiding strictly in presentation; preserve native message/history data and backward compatibility for older turns. If App Server/Desktop attachment behavior differs or cannot be verified, stop and ask the owner instead of implementing a custom prompt workaround. This rule governs attachment submission, not separate bounded ephemeral tasks such as automatic title generation.
- Private file publication is allowed only from explicit links in native
  `agentMessage` items retrieved from `thread/read`. Native assistant links
  may point to any host-local drive path; independently validate a real regular
  file and its size before snapshot creation. The client identifies the native
  thread, item and link index when requesting a snapshot. Snapshot access uses
  the server-issued opaque publication ID.
  Keep the native Markdown text unchanged in history; phone/website render the
  link label as a clickable authenticated download, without a duplicate card.
  Publication IDs reference immutable server-owned snapshots; the client may
  never submit an arbitrary host path or access one through an anonymous route.
  Ordinary absolute paths in message prose are not file cards. `fileChange`
  Diff payloads must be removed before forwarding native frames to mobile.
- Assistant file delivery uses bounded private Gateway snapshots for eligible
  files. An explicit link click prepares the selected file. Opening history or
  listing snapshots must not prepare files. New snapshots expire after 72 hours
  and use the same chunked private delivery for all supported sizes.
- The sole active UI is `web/src/`, including its own package lock and build. `App.tsx` provides only the Android WebView container, Tailnet discovery, back navigation and OS file saving; `src/core` retains only these native shell helpers and `src/storage/database.ts` stores the coordinator. `gateway/` owns host-side bounded services and `tests/` validates active behavior. The former parallel native React UI, visual editor, native OAuth and per-device thread cache are retired. No second simulated chat data source is permitted.
- Browser and Android display actual App Server thread/project data. Canonical IDs, permissions, turn status and messages come from native Codex RPCs, not fabricated client state. Shared project/thread pins are owned by 6v in `.state/sidebar-pins.json` and accessed via the private Web Coordinator. Local display preferences live in the shared React UI. Global/project AGENTS and dedicated-home config.toml are edited through host-owned bounded file RPCs with revision checks. Model/effort choices must come from `model/list`, and permissions from `permissionProfile/list`; reject arbitrary sandbox or approval-policy objects.
- Native projects come from `project/list`. Real project assignment uses `projectId`; moving a thread uses `thread/metadata/update` without changing cwd or relocating files.
- Project creation with a directory is permitted only through authenticated Gateway `workspace/projectDirectories` and `workspace/projectCreate`, which resolve server-issued directory locators under host-approved roots. Never allow direct mobile `project/create` to supply a filesystem path. Do not auto-retry an ambiguous create; return the exact acknowledged result separately from Android cache refresh.
- `workspace/hostFileRead` and `workspace/hostFileWrite` may access only the independently owned `%LOCALAPPDATA%\CodexMobileUI\CodexHome\AGENTS.md` / `AGENTS.override.md` / `config.toml`, or a native `project/read`-confirmed root's active AGENTS file. Never accept a client-supplied file path; reject symlinks, malformed or oversized UTF-8, and stale file revisions. Never log file contents or claim that saving config.toml immediately hot-reloads all settings.
- New chats stay local until first actual send. Create a native thread then send a turn in order; preserve real IDs and drafts on failures. Never auto-retry ambiguous creates or auto-send drafts after reconnect.
- Projectless sessions get their own workspace on first send, prepared by the authenticated Gateway using native `fs/createDirectory` and `fs/getMetadata`. Reject arbitrary client filesystem paths.
- Automatic titles use a bounded ephemeral independent thread and `thread/name/set`; never override an existing user- or server-provided name.
- Use strict Gateway/Web Bridge RPC allowlisting and parameter validation, host/thread isolation, and private Tailnet-only access. WebSocket requires matching same-origin Host and Origin; no public network listener. Extended actions may use only individually validated native methods and bounded named permission profiles, without accepting raw sandbox policy objects. Preserve config.toml inheritance for new threads; the shared settings editor uses only host-owned bounded read/write RPCs and revision checks. Do not expose arbitrary host filesystem roots or unbounded approval/sandbox policy changes. Never log URLs, credentials, private hostnames, chat text, thread IDs or user files.
- Do not claim a build, HTTP health check or local test proves Android login, inference, filesystem permissions or effective OS-level sandboxing.

- Existing-thread Custom permission selection must use a validated thread cwd to let native `thread/start` (ephemeral, without overrides) resolve the effective server config. Pass only its native profile or sandbox policy, approval policy, and reviewer via `thread/settings/update`, and check `thread/resume`. Never reimplement config.toml sandbox rules or accept client-supplied sandbox objects. The native `permissions: null` is not a reset.

## Windows host security
- Keep `.env`, `.state`, `.runtime`, keys, logs and actual `CODEX_HOME` out of Git, private per host. Preserve existing secrets and Funnel mappings.
- The dedicated backend must not be exposed on any public port. Only the private Tailscale listeners for Gateway 48889 and Web Coordinator 4190 are authorized; public Funnel/OAuth ingress is retired. Do not alter unrelated Tailscale routes.
- CCM Tailscale allowlist requires exactly one standalone `tailscale.exe` command per `exec_command`, with no shell wrapper, pipes, redirections or other commands. Confirm `trusted_tailscale: true` and exit code 0.
- Backend startup fails closed if port 45891 belongs to an unknown listener or an owned backend is unhealthy. Require process name, exact private executable layout, owned PID file, listener PID and a bounded PID-file-to-process-start timestamp; when WMI is accessible, also require the matching command line. Under CCM WMI denial, use the verified listener/PID/birth-time fallback, never trust the PID file alone. Gateway follows the analogous rules.
- Runtime discovery verifies complete companion files and fingerprints independent copies. Runtime upgrades happen only at a deliberate restart.
- Proxy settings are inherited from the user's environment or system proxy into the child process. Never modify User/Machine environment settings.
- Interactive native Codex authentication inside each dedicated home remains required for model turns. The Android WebView reaches the existing private Tailnet Web Coordinator; it does not perform a separate Gateway OAuth flow.

## Quality and delivery
- Before packaging a release, check the release version records in `docs/roadmap.md` and follow any one-time entry there. Remove that entry only after its packages are verified and delivered.
- This project is developed in parallel across multiple conversations and machines. Do not build/package the Android App, generate an APK, or trigger APK delivery as an automatic follow-up to code changes, tests, or completion of another task. Only do so when the user explicitly requests an App build. Preserve concurrent work and do not overwrite other developers' uncommitted changes.
- For Web changes, run `npm.cmd --prefix web run build` as well as the existing repository checks. Do not claim visual acceptance without a real browser rendering check.
- Read AGENTS.md, README.md and relevant modules before editing. Run `npm.cmd run check` and `npm.cmd run build:gateway` after changes; check actual host behavior separately.
- Never reuse an expired or task-unapproved Full Access grant. Do not use keyboard/mouse or unrelated tools by default.
- Do not infer port availability from permission-denied queries; obtain verified listener PID and process identity before stop or restart. Never stop active unrelated processes.
- Android packaging uses the fixed `scripts/build-android-stable.ps1` entry. The stable builder MUST pass `-UseWorkspaceCache -WorkspaceCacheRoot <source-root>\\.tmp` to the lower-level builder for preflight and actual build. All writable Gradle caches and TEMP/TMP go under the ignored source checkout `.tmp`, while the installed Gradle distribution is read only. Preserve the independent short-path native build checkout, exclusive locks, incremental outputs and Android SDK; do not write to or reset the user's global Gradle cache. Synchronize Android version metadata, exclude `.worktrees` from fingerprints, and reject stale APKs.
- Release APK requires embedded JS, verified app identity/version, ARM64 libraries, v2 signature and SHA-256. The current signing identity is for testing, not production.
- When a native build appears stalled, inspect the actual Gradle task, child Clang/Ninja processes, CPU activity and persisted build state before interrupting it. Ninja itself can have zero CPU while child Clang compilers are working; R8 can consume CPU for several minutes with no new Gradle log lines. Only stop precisely verified build-owned processes, guard against PID reuse, and recheck the build state immediately before termination. A published or completed build must never be stopped or mistaken for a failed one.
- For an explicitly requested APK build and delivery, publish the verified, versioned APK directly into the current ChatGPT conversation using CCM `publish` with the 6v workspace handle and verified APK path. Return its downloadable publication link in chat. **Never upload release APKs to Quark again.** A CCM publication is a time-limited download snapshot; mention its expiry when available. This replaces all previous APK-to-Quark delivery instructions; Quark handling of large assistant-generated files inside conversations is independent and remains unchanged.
- Keep private and bounded Gateway diagnostics and sanitized request journals; no secrets, raw chat or user identifiers. The Android native diagnostic journal/export panel is intentionally restored for offline troubleshooting. It must sanitize event fields and never include credentials, URLs or chat content; Android APK updates remain release-only.
- Maintain README.md (current state), AGENTS.md (rules), docs/architecture.md (system), docs/mobile-host.md (host runbook), docs/roadmap.md (verification) and docs/funnel-deployment.md (public network security). Delete obsolete paths and dead code rather than keeping shims.
- 6v is the authoritative complete development repository. noha is a **Host-only deployment** at its single `CodexMobileUI` root (no `host-runtime/` sibling deployment, no Android/Web source or dev dependencies). Sync only compiled `dist/gateway`, `dist/shared`, host launch/task scripts, and host-only runtime dependencies as necessary. Do not sync the Codex `.runtime` binary, `.env`, `.state`, OAuth tokens, native `CODEX_HOME`, or private user data; those are separately owned by noha. Do not run the legacy noha `sync-mobile-host.ps1` release updater which recreates `host-runtime`. Commit validated source changes and push only to an already configured remote; never create a public remote without permission.
