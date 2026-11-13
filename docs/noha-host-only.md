# Host-only deployment to noha

The authoritative CodexMobileUI source tree and all Android/Expo builds stay on **6v**.
Build the Windows backend/Gateway on 6v and transfer only a versioned **Host-only** bundle to noha.

## Layout

```text
6v/CodexMobileUI/
  src/, android/, App.tsx, gateway/, scripts/       # source/build machine
  scripts/package-mobile-host.ps1                    # reproducible host packer
  .tmp/noha-host-<version>-<date>/                   # ignored deployment artifact

noha/CodexMobileUI/host-runtime/                     # temporary host-only rollout location
  Start-CodexMobile.cmd, Stop-CodexMobile.cmd, Login-CodexMobile.cmd
  scripts/{mobile-app-server.ps1,mobile-launcher.ps1,mobile-runtime.js,gateway-only.ps1}
  dist/gateway/*.js
  node_modules/ws/
  .env                                                # noha-specific secret, never transfer
  .state/, .runtime/                                  # per-host only, never transfer
```

The **old full noha checkout is retained solely for rollback**. Do not update or compile its mobile source. Once real phone authentication, model inference and restart acceptance pass, relocate the host bundle into a dedicated noha host project and retire the old checkout separately. Avoid moving active processes by renaming directories.

## Packaging / updates

On 6v run `npm.cmd run typecheck:gateway`, `npm.cmd run build:gateway`, then `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-mobile-host.ps1 -OutputDirectory .tmp\noha-host-<version>-<date>`. The bundle includes neither `.env` nor an auth profile, and has SHA-256 checksums.

Transfer to a new noha release directory, verify checksums and the `ws` module, then stage the *noha-owned* `.env` and persistent OAuth state. The Gateway requires `CODEX_APP_SERVER_WS=ws://127.0.0.1:45891`; preserve the noha HTTPS Funnel origin, approval secret and redirect URI. Start/stop scripts only act on verified processes owned by their exact deployment directory. Never overwrite a live release in place or stop a listener merely by port number.

## Verified on 2026-11-13

- `host-runtime` is a 39-file transfer (~264 KiB), with 38 checksummed files and no mobile app source; all checksum checks passed.
- noha private App Server: loopback port 45891, verified ownership/readiness, native `initialize`, `thread/list`, `project/list` passed; empty isolated history.
- noha new Gateway: loopback port 48888, verified ownership/readiness; pilot port 48889 passed before exact-PID old Gateway shutdown.
- Tailscale Funnel remains `https://noha.tail7c23f0.ts.net:8443 -> http://127.0.0.1:48888`; HTTPS `/health` returned 200 from 6v.
- **Pending:** independent noha Codex account/device login (`account_present=false`), authenticated mobile OAuth/WSS and actual model turn. Do not call this an end-to-end accepted deployment until those pass.

For day-to-day operation, use **`host-runtime\Start-CodexMobile.cmd`**, **`host-runtime\Stop-CodexMobile.cmd`**, and **`host-runtime\Login-CodexMobile.cmd`** on noha. Its private `CODEX_HOME` is `%LOCALAPPDATA%\CodexMobileUI\CodexHome`, separate from Desktop's `%USERPROFILE%\.codex`.

## GitHub source/release sync (private)

6v owns all source edits and Android builds. `main` is pushed to the private repository `beifangzhishi-ops/CodexMobileUI`. Only when the entire source checkout is clean and its Gateway typecheck/build pass, run `scripts/release-mobile-host.ps1 -Publish` to push an immutable `host-v<version>-<sha>` tag. GitHub Actions builds a Windows Host-only ZIP and SHA256 sidecar from that **committed tag**; it must not publish an uncommitted 6v working directory as a reproducible release.

On noha the standalone `host-tools\sync-mobile-host.ps1` offers:

- `-Action status`: check the exact owning processes in the currently active host directory.
- `-Action check`: inspect the newest published release without making changes.
- `-Action download`: verify ZIP SHA256 and an internal complete-file manifest, stage an immutable host directory without stopping services.
- `-Action activate`: explicitly switch after owner/health checks, copying only the **local** private `.env` and OAuth state, then verifying both new services; it attempts to restart the previous release on failure.
- `-Action rollback`: explicitly return to the recorded previous release, transferring its latest local OAuth state back first.

Noha does not pull the source repo. A private login to GitHub CLI is required to download releases. Do not use a shared ZIP password, hard-coded GitHub PAT, or commit/transfer any `CODEX_HOME`, `.state` or `.env` content to GitHub.
