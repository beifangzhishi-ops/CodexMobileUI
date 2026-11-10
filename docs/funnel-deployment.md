# MobileUI Gateway and Tailscale Funnel

## Network topology and current state

Each Windows host has a complete CodexMobileUI repository and its own private OAuth configuration.

```text
Android HTTPS/WSS :8443 -> Tailscale Funnel
                         -> HTTP/WebSocket Gateway 127.0.0.1:48888
                         -> native MobileUI App Server 127.0.0.1:45891
                         -> %LOCALAPPDATA%\CodexMobileUI\CodexHome
```

Only the Gateway is eligible for public Funnel routing. The native App Server is always loopback-only. Do not change unrelated existing Funnel port mappings, Windows proxy settings or any other client processes. The Gateway and native backend are separately managed; see [mobile-host.md](mobile-host.md).

**Rollout boundary (2026-11-11):** 6v's private native backend is healthy and a temporary OAuth Gateway has completed authenticated thread/list forwarding; the private Codex account is not yet signed in. The installed Gateway retains its original private configuration and is not yet pointed to the private backend. Neither source changes nor temporary local OAuth verification prove live Funnel routing to the new backend.

## Local private configuration

`.env.example` contains only placeholders, not working secrets. On each host, the ignored `.env` contains:

- `MOBILE_PUBLIC_ORIGIN`: the approved HTTPS host origin with port 8443.
- `MOBILE_APPROVAL_SECRET`: a separate strong per-host random secret; never commit or send it in chat.
- `MOBILE_REDIRECT_URI=codexmobileui://oauth`.
- `MOBILE_GATEWAY_PORT=48888`.
- `CODEX_APP_SERVER_WS=ws://127.0.0.1:45891`: fixed private upstream.

Do not regenerate an existing Gateway OAuth secret during the backend transition. The phone's existing Gateway OAuth tokens remain logically separate from the new Codex model login. For model turns, run native Codex device authentication into the private `CODEX_HOME` using the dedicated login entry; do not copy the desktop profile's credentials.

## Phone authentication

1. Enter the host's approved HTTPS Funnel origin including `:8443` in CodexMobileUI.
2. Start the OAuth authorization flow in the system browser and enter the host-local secret.
3. On the no-store authorization-success page, explicitly tap Return to CodexMobileUI.
4. Verify callback, PKCE exchange, authenticated WebSocket and native `initialize` against the *dedicated* backend.
5. Authenticate the native private Codex home separately before testing model requests.

A phone can connect over ordinary HTTPS without a local Tailscale app when the authorized Funnel is active. Android OAuth success confirms Gateway authorization, **not** the Codex model account in the new profile.

## Security, diagnostics and operations

Gateway binds only to 127.0.0.1 and authenticates before opening its upstream socket. Only RPC methods in the explicit allowlist are forwarded. The native App Server and direct file RPCs must never be mapped to public Funnel.

Use CCM's Tailscale allowlist only with a *single standalone Tailscale CLI invocation per execution*. Do not combine multiple Tailscale operations, pipes, shell wrappers or redirections; verify the trusted-command result and exit code. Avoid blanket Funnel reset/stop operations that could disrupt unrelated services.

The per-host sanitized request journal lives under ignored `.state/mobile-gateway-requests.jsonl` with bounded rotation. It records timestamps, fixed event categories, status and duration, never raw URLs, hostnames, IP addresses, authorization headers, secret values, OAuth codes, tokens, thread IDs or conversations. Android can export its own bounded safe diagnostic journal manually.

For safe backend switching, first run the private backend on its dedicated port and verify process ownership, an empty native project/thread catalog and separate model authentication. Only then update the private Gateway upstream setting and restart **the owned Gateway alone** after verifying its PID. Do not stop, restart or alter unrelated applications. Verify HTTP health, then authenticated WSS to `thread/list`, then a real Android message.

## Validation checklist

- [ ] MobileUI native backend 45891 independently healthy and bound to the private data home.
- [ ] Native Codex model login completed in the isolated profile.
- [ ] Existing OAuth secret and Funnel routes preserved.
- [ ] Gateway 48888 restarted from the new build and forwarding to 45891.
- [ ] HTTPS Funnel and WSS relay verified on both hosts.
- [ ] Real Android login, project selection, new chat, inference and recovery tested end to end.

The earlier OAuth and public-network checks validated the Gateway design, but do not imply this new isolated backend has already passed end-to-end testing.
