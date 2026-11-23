## Mobile Tailnet deployment (2026-11-20)

手机侧推荐采用 FlClash/Mihomo 内置 Tailscale，并通过脚本覆写**合并**原订阅的
Fake-IP 过滤规则，避免覆写破坏普通代理节点的 DNS 解析。
完整配置、脚本和排查记录见 [FlClash 内置 Tailscale 手机搭建指南](mobile-flclash-tailscale.md)。

6v and noha each run the compiled private Gateway on loopback and
their Tailscale IPv4 interface at port 48889. Their native App Servers
remain isolated on loopback 45891. Configure the Android client once
with `http://100.76.74.124:48889`; the server's `/hosts` roster
lists both machines and relays mobile WebSocket traffic to the selected
host. The old 48888 Gateway listeners and public 8443 Funnel entries
were decommissioned. Gateway OAuth is no longer required for phone
connections; independent native Codex authentication is unchanged.
The Gateway deployment passed read-only RPC tests on both hosts;
Android APK/device acceptance remains outstanding.

## Private assistant file delivery (source only, not deployed)

The authenticated Gateway recognizes only explicit Windows file links within
real native `agentMessage` items from `thread/read`; plain-text absolute paths
are not resolved. The assistant remains unaware of Android/web versus desktop:
native message text is preserved, while Android renders just the original link
label as a clickable authenticated download, without duplicate file cards.
Any local-drive regular file can be published, independent of cwd or extension;
missing/inaccessible files still cannot be served. At **12 MiB or less**,
files are copied into `.state/published-files` as immutable private snapshots.
Above 12 MiB, no content snapshot is made; the host uploads the original file
to its logged-in Quark Cloud Drive desktop client. The client chooses its usual
`夸克上传文件` folder. The Gateway persists only metadata and statuses:
`quarkUploading`, `quarkUploaded` and `quarkFailed`. The phone does not receive
a Quark share link or attempt to download Quark files. Missing/inaccessible
source files return an unavailable status when the inline link is tapped.

The helper `gateway/quark-transfer/cloud_transfer.py` was ported from CCM/WCM.
Gateway launches it without CCM, using Quark Desktop's loopback API and current
WSG/account mapping, and confirms upload success from the desktop task database
(terminal success, 100%, matching sizes). Each Windows host needs Python 3,
Quark Cloud Drive installed, running and logged in. A failed upload status is
durable and is not automatically retried on a conversation refresh.

`workspace/publication/list` takes a native thread ID and returns the file
metadata; `workspace/publication/read` takes only a snapshot ID and byte offset
and reads private bounded chunks after OAuth/WSS authentication. There is no
anonymous HTTP download endpoint, CCM runtime dependency, or arbitrary
mobile-selected host file path. `build:gateway` includes the helper alongside
the compiled Gateway modules; the Host-only bundle also carries it. The live
Gateway and noha deployments have not been updated in this source-only change.

# Project directory picker

The Android new-project dialog first selects a connected computer and then
browses directories **on that computer**. The authenticated MobileUI Gateway
lists only directories under the host user's `Documents` and `Desktop` by
default. To include other project trees, add `MOBILE_PROJECT_ROOTS` to that
computer's private `.env` as a semicolon-delimited list of approved absolute
directories. Restart only the verified, MobileUI-owned Gateway for the setting
to take effect. Never expose filesystem roots, Windows system directories, or
secrets. A project references the selected existing folder and does not copy,
move, overwrite or delete its contents.

# Independent Windows MobileUI host

## Runtime layout

- Codex kernel source: newest complete Windows Codex Desktop installation or its Desktop-managed runtime cache. It supplies executables only; the Desktop app is not launched or required.
- Verified immutable runtime copy: `<checkout>\.runtime\mobile\<sha256-fingerprint>\`.
- Private persistent `CODEX_HOME`: `%LOCALAPPDATA%\CodexMobileUI\CodexHome`. The default Windows `%USERPROFILE%\.codex` is not read or altered. No session, project, login, configuration or writer-lock import is performed.
- MobileUI App Server: `ws://127.0.0.1:45891` (native WebSocket + local `/readyz`). It has a private PID and startup mutex.
- Authenticated Gateway: `http://127.0.0.1:48888` (OAuth PKCE + WSS) with a fixed upstream of `ws://127.0.0.1:45891`.
- Gateway process owner: Windows Task Scheduler, per-user task `CodexMobileUI Gateway`, interactive token and **Limited** (not administrator) run level. At-logon auto-start and on-demand launch use the same task; an ordinary `Start-Process` launched by CCM would inherit its restricted token.
- Uploaded camera/gallery/document attachments: `<checkout>\.state\mobile-uploads\` (Git-ignored, Gateway-writable). Do not put them under the independent App Server `CODEX_HOME`: the workspace-scoped Gateway may not have write access there. Each file is named by the Gateway, with an 8 MiB limit and restricted extensions. The Gateway and its App Server use the same host paths to reference the completed files. New `workspace/attachmentRead` uses the same authenticated WSS session, bounded 64 KiB chunks, exact managed-directory/filename checks and non-symlink file checks; there is no generic path read. A Gateway rebuild and controlled restart are required to deploy this method, separately from Android APK builds.
- Public routing, when already explicitly authorized: Tailscale Funnel HTTPS 8443 -> loopback Gateway 48888. The native backend is never public.

These paths and identities are intentionally independent of the developer's everyday Desktop sessions. The two products can run at the same time, but they do not automatically share conversations, projects or login state. Reusing a project working directory can still cause ordinary concurrent filesystem edits: `CODEX_HOME` isolation is not a file sandbox.

## Entry points

- `Start-CodexMobile.cmd`: verify the source kernel, stage a fingerprinted private executable copy, start owned native App Server, then the authenticated Gateway.
- `Stop-CodexMobile.cmd`: stop this checkout's owned Gateway and its owned App Server, in that order; it does not affect other Windows clients.
- `Login-CodexMobile.cmd`: interactive Codex device authentication into the **private** data home. Model access may fail until this step is completed. Android OAuth for Gateway access is independent and must also be completed.
- `scripts/mobile-launcher.ps1 -Action status`: status of both dedicated services.
- `scripts/mobile-app-server.ps1 -Action status`: backend identity, readiness and data-home location.
- `scripts/gateway-only.ps1 -Action status`: Gateway ownership and HTTP health.
- `npm.cmd run build:gateway`: compile Gateway from this checkout before starting it.
- `scripts/install-gateway-task.ps1`: run once per host from a normal Windows PowerShell session, or by CCM with approved sandbox escalation, to register the least-privilege task. The existing task is left intact if it matches this checkout; mismatched tasks are not overwritten. `scripts/gateway-only.ps1 -Action start` starts this task; `-Action task-run` is reserved for the Task Scheduler action.

**CCM note:** its default restricted execution context cannot query/register Windows Task Scheduler tasks and should not start the long-lived Gateway directly. When managing start/installation through CCM, request authorized escalation for the narrowly scoped command rather than granting the Gateway administrator access. Once launched, the Gateway process remains independent of CCM. Verify by reading the Gateway PID from `.state/mobile-gateway.pid`, confirming the owner/listener and `TokenIsRestricted=0`, then testing `127.0.0.1:48888/health` and authenticated WSS.

All launcher operations are local to their host. Use existing workspace paths for scripts; do not run binaries from another project's source. The 6v private profile, backend and login have been verified. On noha, the single Host-only root installation replaces `host-runtime/` as of 2026-11-13; its isolated backend and Gateway are both running and healthy with normal Windows tokens. Keep noha's `.runtime`, `.env`, `.state` and independent `CODEX_HOME` on that machine. Transfer only 6v's compiled Host JS and Host scripts; never redeploy a nested `host-runtime`.

## Safe startup and switch

1. Build and test the new source with `npm.cmd run check` and `npm.cmd run build:gateway`.
2. Check the existing Gateway's private `.env`: `CODEX_APP_SERVER_WS` must be `ws://127.0.0.1:45891` before the new Gateway can be started. Keep the original OAuth secret, Funnel origin and callback unchanged.
3. Start and verify the private App Server first. Validate `/readyz`, native `initialize`, `project/list` and `thread/list` with no access to the default Desktop home. A newly created profile normally has zero projects/threads.
4. Authenticate the private Codex home separately using the interactive login entry if necessary; do not copy `auth.json` from another profile.
5. Only after the backend is confirmed healthy should the owner-controlled Gateway be restarted and tested through OAuth/WSS. Do not change public Funnel routing.
6. Install the updated mobile APK and validate new chat, first turn, project creation/selection, title generation, file operations, drafts and offline recovery. These steps require a real device before marking deployment complete.

Never infer successful model authentication from a running `/readyz` endpoint. Changing `CODEX_HOME` separates sessions and projects; the same HTTPS hostname/token can still reach the Gateway after its upstream is switched, but old Android thread caches must not be reused.

## Host-backed rules and config editing

The Android Settings screen reads/writes only the currently selected independent
MobileUI backend home, `%LOCALAPPDATA%\CodexMobileUI\CodexHome`, not the Desktop
`%USERPROFILE%\.codex` profile. `config.toml` is the exact home-level file,
whether it already exists or is first created by an explicit save. Global
instructions resolve to the effective home `AGENTS.override.md` when it is
non-empty, falling back to `AGENTS.md`. Project rule editing derives its folder
from the authenticated native `project/read` result and requires selecting a
root for a multi-root project. It edits the effective AGENTS file at that root;
nested files are not merged into this editor.

The Gateway offers only `workspace/hostFileRead` and `workspace/hostFileWrite`.
Mobile clients cannot supply host paths. UTF-8 content is size limited and
symlinks are refused; saving requires a matching filename and SHA-256 revision
to avoid overwriting a newer Desktop edit. Opening an editor and periodic
foreground refreshes read actual host files; unsaved mobile drafts are not
replaced by a refresh. The file contents are never written to diagnostics.
Saved config settings may require a new Codex session or an explicit owned
App Server restart; the Gateway must never restart Desktop automatically.

## Process ownership and failure rules

Startup and stop validate the PID-file owner, executable path beneath `.runtime\mobile`, native `app-server` command-line target and listener PID. If an unknown process occupies 45891, startup **fails** rather than adopting it. An owned but unhealthy backend also fails rather than being force-replaced. All services bind only to loopback.

The backend inherits `CODEX_HOME` and detected proxy settings as *process environment*, without changing global Windows settings. Runtime copies are immutable and per-fingerprint; never clean a copy used by an active backend.

Under CCM's restricted Windows token, CIM/WMI process-command-line and TCP ownership queries may return access denied. Startup, status and shutdown must then require the exact stored PID, a verified private executable layout, a single loopback listener owned by that PID, and a PID-file timestamp no more than 60 seconds after process creation. If any element is missing or inconsistent, report the instance as unowned; never adopt or stop it. Gateway uses the analogous PID, executable and loopback-listener checks.

A system policy that blocks process inspection, startup, or writing the private data home must surface an approval/error. Never bypass that restriction by killing other services or mutating the user's normal Desktop profile.

## Validation status

On 6v, owned private App Server startup, data-home separation, native login and real model inference have passed. A private thread contains one completed model turn with both user and assistant messages; read-only native thread/read and public HTTPS 8443 Funnel OAuth/WSS thread/list and thread/read recovered that completed turn. Gateway retains loopback port 48888, forwarding only to native App Server 45891. On 2026-11-12, the ARM64 0.1.5 Release APK passed identity, embedded-JS, ABI, v2 signature and SHA-256 checks; Quark accepted it with FINISH/100% and matching size. On 2026-11-13, noha migrated the active Host to its single repository-root path, preserving its machine-private configuration and OAuth state, and verified healthy local App Server/Gateway with `TokenIsRestricted=0`. Physical Android acceptance, new chat/turn and concurrent Desktop behavior remain distinct tests; the noha **post-migration public Funnel/authenticated WSS** check has not been repeated.
