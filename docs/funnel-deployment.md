# CodexMobileUI via Tailscale Funnel (two Windows hosts)

## Current deployment

The owner authorized **public Tailscale Funnel** (not private Tailscale Serve).
On each host, HTTPS port **8443** is an independent Funnel reverse proxy to
**http://127.0.0.1:48888**, where this project's OAuth PKCE/WebSocket Gateway
listens. The raw shared Codex App Server stays on loopback **45789** and must
never be made public. The original Funnel services on the primary computer's
443 and 10000 ports are unrelated and must remain untouched.

The two hosts have **separate** mobile authorization secrets and stored
token state. The initial authorization secret is a host-local 256-bit
cryptographically generated value, never a shared preconfigured password.
Neither the secret nor the host's real Funnel DNS name belongs in Git.

The primary 6v host runs the source checkout's compiled Gateway. The noha
host runs a small deployment-only bundle produced by
scripts/package-gateway-deployment.ps1, under the user's normal projects
directory. That bundle includes its own AGENTS.md, README.md, built Gateway,
runtime WebSocket dependency and gateway-only scripts, but no secrets.
Send it to noha via Tailscale Taildrop and preserve the existing .env/.state
on subsequent updates.

## Phone setup

1. Open the already installed **CodexMobileUI** app and select **Add computer**.
2. Enter the first host's exact HTTPS Funnel origin, including **:8443**.
   The origin must have the form https://computer.tailnet.ts.net:8443,
   with no path, login credentials or trailing query.
3. Choose **OAuth authorization**. The system browser opens the host's
   consent form. Enter that host's local MOBILE_APPROVAL_SECRET from its
   private .env (on the PC; do not publish or send it in chat).
4. After approval the browser should return to CodexMobileUI using
   codexmobileui://oauth. Then confirm the actual thread list appears.
5. Repeat the same process for the second host, using its distinct Funnel
   origin **and** distinct approval secret.

The phone **does not need the Tailscale app**: Funnel is HTTPS over the
ordinary internet. A normal private Tailscale hostname without :8443
may point to an unrelated service on 443 and is not the mobile gateway.

## Security and validation

The Gateway listens only on 127.0.0.1:48888; Tailscale terminates TLS and
proxies to that local port. Incoming WebSockets authenticate with a
short-lived OAuth access token. The server explicitly allows only
initialize, initialized, thread/list, thread/read, thread/resume,
thread/start and turn/start. Unknown client RPCs do not reach Codex.
An authorized turn/start can still run host-side tools, so do not share
credentials or grant access to another person's phone.

Both public Funnel gateways have passed owner-only automated
HTTPS OAuth PKCE → WSS initialize → thread/list → thread/read tests against
the actual local shared App Servers. The test revokes its refresh token,
does not send a turn, and never prints host secrets, tokens, thread IDs
or messages. It is not a substitute for testing Android's deep-link
callback, SecureStore or actual live chat on the phone.

The start/stop/status script is **scripts/gateway-only.ps1**. It owns only
the Mobile Gateway and never starts or stops the shared stack, Desktop
or AOI. For a new host, **scripts/init-gateway-env.cjs** generates the
host-private configuration. Do not run it on an existing configured
host because it will refuse to rotate a real secret. The read-only
public end-to-end probe is **scripts/probe-funnel-auth.cjs**.

Funnel is configured in the Tailscale daemon's background mode and can
survive a daemon restart. The gateway process itself must be running
for the route to work; if the computer reboots, start only its Gateway
again after login. An optional logon startup task can be configured
independently; never enable a broad shared-stack restart as a side effect.

To disable only the mobile public entrypoint, run the Tailscale CLI's
funnel command with --https=8443 off on the selected computer. Never use
funnel reset or blanket stop commands because other Funnel routes may
be serving unrelated applications.
