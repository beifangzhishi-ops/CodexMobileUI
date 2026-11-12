# Independent Windows MobileUI host

## Runtime layout

- Codex kernel source: newest complete Windows Codex Desktop installation or its Desktop-managed runtime cache. It supplies executables only; the Desktop app is not launched or required.
- Verified immutable runtime copy: `<checkout>\.runtime\mobile\<sha256-fingerprint>\`.
- Private persistent `CODEX_HOME`: `%LOCALAPPDATA%\CodexMobileUI\CodexHome`. The default Windows `%USERPROFILE%\.codex` is not read or altered. No session, project, login, configuration or writer-lock import is performed.
- MobileUI App Server: `ws://127.0.0.1:45891` (native WebSocket + local `/readyz`). It has a private PID and startup mutex.
- Authenticated Gateway: `http://127.0.0.1:48888` (OAuth PKCE + WSS) with a fixed upstream of `ws://127.0.0.1:45891`.
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

All launcher operations are local to their host. Use existing workspace paths for scripts; do not run binaries from another project's source. The 6v private profile, backend and login have been verified. The noha private backend/login have not yet been provisioned and are paused by the owner.

## Safe startup and switch

1. Build and test the new source with `npm.cmd run check` and `npm.cmd run build:gateway`.
2. Check the existing Gateway's private `.env`: `CODEX_APP_SERVER_WS` must be `ws://127.0.0.1:45891` before the new Gateway can be started. Keep the original OAuth secret, Funnel origin and callback unchanged.
3. Start and verify the private App Server first. Validate `/readyz`, native `initialize`, `project/list` and `thread/list` with no access to the default Desktop home. A newly created profile normally has zero projects/threads.
4. Authenticate the private Codex home separately using the interactive login entry if necessary; do not copy `auth.json` from another profile.
5. Only after the backend is confirmed healthy should the owner-controlled Gateway be restarted and tested through OAuth/WSS. Do not change public Funnel routing.
6. Install the updated mobile APK and validate new chat, first turn, project creation/selection, title generation, file operations, drafts and offline recovery. These steps require a real device before marking deployment complete.

Never infer successful model authentication from a running `/readyz` endpoint. Changing `CODEX_HOME` separates sessions and projects; the same HTTPS hostname/token can still reach the Gateway after its upstream is switched, but old Android thread caches must not be reused.

## Process ownership and failure rules

Startup and stop validate the PID-file owner, executable path beneath `.runtime\mobile`, native `app-server` command-line target and listener PID. If an unknown process occupies 45891, startup **fails** rather than adopting it. An owned but unhealthy backend also fails rather than being force-replaced. All services bind only to loopback.

The backend inherits `CODEX_HOME` and detected proxy settings as *process environment*, without changing global Windows settings. Runtime copies are immutable and per-fingerprint; never clean a copy used by an active backend.

Under CCM's restricted Windows token, CIM/WMI process-command-line and TCP ownership queries may return access denied. Startup, status and shutdown must then require the exact stored PID, a verified private executable layout, a single loopback listener owned by that PID, and a PID-file timestamp no more than 60 seconds after process creation. If any element is missing or inconsistent, report the instance as unowned; never adopt or stop it. Gateway uses the analogous PID, executable and loopback-listener checks.

A system policy that blocks process inspection, startup, or writing the private data home must surface an approval/error. Never bypass that restriction by killing other services or mutating the user's normal Desktop profile.

## Validation status

On 6v, owned private App Server startup, data-home separation, native login and real model inference have passed. A private thread contains one completed model turn with both user and assistant messages; read-only native thread/read and public HTTPS 8443 Funnel OAuth/WSS thread/list and thread/read recovered that completed turn. Gateway retains loopback port 48888, forwarding only to native App Server 45891. On 2026-11-12, the ARM64 0.1.5 Release APK passed identity, embedded-JS, ABI, v2 signature and SHA-256 checks; Quark accepted it with FINISH/100% and matching size. On noha, private backend startup, login and safe Gateway cutover remain paused by the owner; existing services were not modified. Actual Android installation, on-device authentication, new chat/turn and broader UI acceptance, concurrent Desktop operation and noha deployment remain separate unverified gates.
