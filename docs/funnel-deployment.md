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

**OAuth and request-log status (2026-11-05):** Both hosts run source-built Gateways with independent public HTTPS health checks and sanitized request journals. The installed Android 0.1.2 app successfully completed a 6v OAuth login through the explicit Return to CodexMobileUI link. The 6v Gateway recorded consent HTTP 200, authorization-code exchange HTTP 200, authenticated WebSocket and upstream readiness. Device validation of phone thread reads, chat turns and noha login remains pending.

**Two-host repository layout:** 6v uses
`C:\\Users\\Songjx\\Documents\\ChatGPT\\CodexMobileUI`, and noha uses
`C:\\Users\\noha\\Documents\\ChatGPT\\CodexMobileUI`. Both have the same
complete Git repository and checked-out commit. Both compile and run their
Gateway from the local checkout and maintain independent private `.env`,
`.state`, dependency and build-cache directories. The noha private OAuth
configuration and persisted token state were preserved during the migration;
its independent Gateway was cut over to the current checkout. Never touch
the shared App Server, Desktop, AOI, or unrelated Funnel mappings.

**Funnel verification (2026-11-05):** CCM's built-in Tailscale exemption was
confirmed on **both** computers without global Full Access. Each invocation
contained exactly one standalone Tailscale CLI command, exited 0, and reported
`trusted_tailscale: true`. Both computers have independent public Funnel
port 8443 entries routing to their own loopback 48888 Gateway. Following noha
cutover, HTTPS health requests from both 6v and noha to the noha public origin
returned HTTP 200 and the expected JSON response, and the noha Gateway's
durable request journal was created. Windows Schannel-based curl.exe HTTPS
checks under the restricted CCM token can fail with a local credential error;
Node's HTTPS client was used to verify the same public endpoint without
disabling TLS validation.

When checking Tailscale through CCM, put **only** the following single command
in its own exec_command call on each Worker:

    tailscale.exe funnel status

Never combine it with `tailscale.exe status`, `tailscale.exe serve status`,
PowerShell output statements, pipes, or other shell commands in the same
exec_command. The trusted whitelist is command-shape-sensitive; compound calls
can return a Windows Tailscale local-service pipe access denial despite healthy
Funnel configuration. Require `trusted_tailscale: true` and exit code 0.
Do not use a timed CCM Full Access grant to bypass this command-shape rule.

## Phone setup

1. Open the already installed **CodexMobileUI** app and select **Add computer**.
2. Enter the first host's exact HTTPS Funnel origin, including **:8443**.
   The origin must have the form https://computer.tailnet.ts.net:8443,
   with no path, login credentials or trailing query.
3. Choose **OAuth authorization**. The system browser opens the host's
   consent form. Enter that host's local MOBILE_APPROVAL_SECRET from its
   private .env (on the PC; do not publish or send it in chat).
4. After approval the browser displays an **authorization successful** page.
   Tap **Return to CodexMobileUI** and allow Android to open the app. This
   explicit tap opens the registered codexmobileui://oauth callback; it is not
   an automatic browser redirect. Confirm the actual thread list appears.
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

## Authorization and troubleshooting

The gateway adopts CCM's two-page flow: the authorization endpoint validates
PKCE and redirects to the consent page, which carries the validated request
fields in an HTML form. POST consent revalidates them, shows a useful error
and the same form when a key is incorrect. After a correct secret it returns
a no-store success page containing a single, escaped callback link. The user
must tap that link to return to Android, avoiding blocked external-scheme
redirects from a browser POST. Consent does not rely on a
a server-side page-expiration timer: the owner can enter a key later or after
a Gateway restart. A created authorization code is valid for ten minutes,
survives a Gateway restart, and is consumed once after correct PKCE exchange.
Do not repeat a code exchange blindly when its outcome is uncertain.

A wrong key means the value does not match that computer's own local
authorization secret; copy only the value after the assignment sign from that
host's private configuration. Never send the value in chat or issue reports.
When the Android browser cannot return to the app, first check whether the
success page and its Return to CodexMobileUI link are shown. Verify the app
was built with the registered custom URI scheme and use a fresh authorization
flow if the link cannot open the app. The 2026-11-05 real-device attempt
reached the primary Gateway and recorded repeated consent_granted events,
but no /oauth/token or WebSocket activity: the former POST 302 did not
complete the callback. The explicit-tap flow is integration-tested but still
awaits real-device validation.
The separate server-side HTTPS/WSS probe never substitutes for a real
Android deep-link check; the 6v phone callback was verified on 2026-11-05.

The Gateway's persistent request log is stored in the private ignored
.state/mobile-gateway-requests.jsonl, with two bounded rotated copies.
Each request receives a sequence ID, a receipt event and a finish or abort
event; the log captures timestamp, fixed route category, HTTP status, duration
and coarse client type. WebSocket upgrade/auth events and predefined OAuth
decisions are also recorded. The coarse client type is inferred from the
User-Agent and is **not proof of device identity**. No raw URLs, query/form
data, client IPs, full User-Agent strings, codes, tokens, PKCE values,
credentials or private host names may enter the journal.

On 6v, inspect the last half-hour through:

    & 'C:\Users\Songjx\Documents\ChatGPT\CodexMobileUI\scripts\show-gateway-requests.ps1' -Minutes 30 -Filter oauth

Use -Filter android to view UA-classified Android clients, or -Filter all for
health and WebSocket events. Run the same script in noha's full checkout to
inspect its own independent .state journal. Historic .out/.err files are not
retroactively populated by the request-journal implementation.

Funnel is configured in the Tailscale daemon's background mode and can
survive a daemon restart. The gateway process itself must be running
for the route to work; if the computer reboots, start only its Gateway
again after login. An optional logon startup task can be configured
independently; never enable a broad shared-stack restart as a side effect.

To disable only the mobile public entrypoint, run the Tailscale CLI's
funnel command with --https=8443 off on the selected computer. Never use
funnel reset or blanket stop commands because other Funnel routes may
be serving unrelated applications.
