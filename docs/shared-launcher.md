# Windows shared-stack launchers

Status: source integration and local automated checks only. No live multi-launcher handoff, real Desktop launch, Funnel route, or Android-device test has been performed.

## Components

- `Start-CodexMobile.cmd` starts the shared stack if absent, or hot-attaches to a verified running stack, then starts the local authenticated mobile Gateway.
- `Stop-CodexMobile.cmd` stops only the Gateway started by this checkout and any shared-stack processes launched by this checkout.
- `Start-Codex-Shared-Proxy.cmd` retains the AOI-style Desktop + Clash + shared-stack launch entry.
- `shared-start.cmd` and `shared-stop.cmd` control only the shared stack, subject to process ownership.
- `scripts/shared-stack.ps1`, `scripts/shared-runtime.js`, `scripts/shared-app-server-proxy.js`, and `scripts/Start-Codex-Shared-Proxy.ps1` are standalone copies of the AOI launch modules. They do **not** load code or settings from AOI at runtime.

## Shared stack ownership and hot attach

Both launchers use localhost **45789** for the compatibility WebSocket proxy and **45790** for the real Codex App Server. A machine-wide named mutex serializes launch/stop decisions across checkouts.

If both ports are listening, both `/readyz` checks pass, and the listening processes match the expected compatibility-proxy and App Server command signatures, any launcher can **hot-attach**, without stopping or restarting them. A launcher remembers its own processes by repository-local PID files and verifies the command and executable path before stopping. Other launchers' PID files are not adopted or rewritten.

If the ports are busy but the stack cannot be identified as healthy, startup fails closed. If an owned service is unhealthy, startup does not silently kill/restart it. Launcher exit does not stop the server. Only an explicit stop from the owner can stop its stack.

**Operational caution:** stopping an owned stack disconnects all consumers, even ones that hot-attached from other projects. Check running turns before an explicit stop. The launcher does not yet query active turns or implement cross-client approval arbitration.

## Mobile Gateway

Gateway is a separate Node.js service on **127.0.0.1:48888**. It uses `gateway/` for OAuth PKCE, token validation, and an authenticated native Codex WebSocket relay to 45789. No raw App Server, Gateway, or model-proxy port is directly exposed by this launcher.

Configure a local ignored `.env` using `.env.example` with `MOBILE_PUBLIC_ORIGIN`, a random `MOBILE_APPROVAL_SECRET` of at least 24 characters, `CODEX_APP_SERVER_WS=ws://127.0.0.1:45789`, and `MOBILE_GATEWAY_PORT=48888`. Process environment overrides local file values. First build the Gateway with `npm run build:gateway`.

The launcher never manages Tailscale Funnel itself. Configure a dedicated Funnel HTTPS route **only after** reviewing the Gateway security boundary, OAuth, and path permissions against a real host. Gateway startup health does not prove OAuth or end-to-end mobile operation.

Gateway process ownership is separate from stack ownership. Duplicate starts reuse only this checkout's verified healthy Gateway. A Gateway owned by another checkout, or an unidentified process occupying 48888, is not adopted or terminated.

## Verification

Use `npm run check` to run the TypeScript tests and copied AOI proxy/runtime tests. The PowerShell entrypoints need a full-permission Windows manual test for first boot, hot attach in either order, simultaneous startups, shutdown from both checkouts, Store Desktop identity, and interruption of active turns.
