# CodexMobileUI system architecture

## Source of truth

- **Windows Codex App Server**: native thread/turn/item history, model settings, approvals, project `cwd`.
- **Android SQLite**: cached thread snapshots, text messages already viewed, host list and per-thread unsent drafts. No concurrent mobile-side inference engine or fake thread IDs.
- **Android SecureStore**: per-host OAuth access and refresh tokens. No hardcoded client secret.
- **Host gateway**: owner-authenticated HTTPS/WSS entry point with one-to-one relay to loopback shared Codex App Server. The gateway is a different service from CCM.

## Data flow

1. Owner enters host HTTPS origin (6v or noha); app checks existing SecureStore session.
2. If no session, system browser opens host OAuth Authorization Code + PKCE S256 flow; owner enters locally configured consent secret. Browser returns a one-time code; Android exchanges the code, stores tokens securely.
3. App opens WSS `/connect`, supplies an access token as the first JSON message, and gateway validates it **before** opening the upstream Codex socket. A successful reply is `{type:"ready"}`.
4. App sends Codex `initialize` / `initialized`, then `thread/list`, `thread/resume` and `thread/read`. The gateway passes these messages through unchanged to the existing localhost shared Codex App Server.
5. Mobile receives native Codex events, displays new text and reconciles stable thread/turn/item history on completion. A dropped connection triggers reconnect; committed messages are retrieved from Codex, deduplicated and stored locally.
6. When offline, already cached messages remain readable and the composer persists a draft. The draft **never automatically sends** after reconnect.

The thread list follows native pagination with cursor-loop detection. Unrecognized `thread/list` or `thread/read` responses fail closed instead of replacing cached history with an empty set. Messages for an unfinished turn are rendered but not written to the confirmed-history cache; a subsequent final snapshot reconciles them. Draft writes are serialized per host+thread so closing a composer promptly or sending successfully cannot allow stale asynchronous saves to overwrite the latest draft.

## Trust boundaries

- Public Funnel routes must terminate at the **authenticated** gateway, not at the app server or model proxy.
- OAuth credentials apply only to the selected host and do not constitute authority to read arbitrary filesystem paths.
- Each future endpoint needs host/thread/cwd-level authorization, path canonicalization, upload size enforcement and event correlation.
- The gateway currently proxies native RPC messages from the authorized owner without a per-method allowlist. This is a personal full-trust capability and must be reviewed before publicly exposing any route; there is no public registration or least-privilege multi-user separation.
- OAuth approval is local-host-specific; code challenge and redirect URI are exact-match; codes are short-lived and one-time; tokens are stored as hashes on disk.
- Access/refresh tokens must never occur in URL parameters, logs, Git or reports. Consent secret is local environment input, not committed.

## Operational limits today

**Implemented and tested in a loopback mock:** OAuth, local WSS relay, JSON-RPC request forwarding, thread/message data normalization. **Also observed on the two actual shared App Servers:** native read-only `initialize`, `thread/list`, and `thread/read`; sampled messages on the primary host were text-parser compatible. Primary host additionally passed a temporary localhost OAuth PKCE → authenticated gateway WSS → native `thread/list` via `scripts/probe-authenticated-relay.mjs`. **Not yet tested:** Android browser OAuth callback, Android native rendering, live message send/stream, long-running background reconnection, multi-client approval, local notifications, file protocol.

The immediate live validation sequence should be: inspect native App Server compatibility, open a real thread read-only through an authenticated local gateway, verify the Android PKCE callback and cached thread display on an installed device, and only then test sending a turn and streaming/rollback. Reuse the existing shared service without stopping or editing it.

## Modules

The optional Windows scripts in `scripts/` host the shared proxy/backend or attach to an already healthy stack, without any runtime AOI dependency. The local Gateway remains independently owned by CodexMobileUI; see [shared-launcher.md](shared-launcher.md). Shared-stack ownership is per launching checkout, not per connected client.

| Module | Responsibility |
| --- | --- |
| `src/core/host.ts` | validate HTTPS target host |
| `src/core/protocol.ts` | typed native Codex thread/message extraction |
| `src/core/threadApi.ts` | paginated native thread listing, cursor validation |
| `src/core/transport.ts` | WSS auth, JSON-RPC request, notifications |
| `src/auth/` | PKCE browser and SecureStore token rotation |
| `src/session/` | single active thread subscription/reconciliation |
| `src/storage/` | SQLite materialized cache and unsent drafts |
| `src/storage/writeQueue.ts` | testable sequential writes for independent drafts |
| `src/ui/`, `App.tsx` | native chat/navigation/rendering |
| `gateway/oauth.ts` | authorization, token mint/validate/revoke |
| `gateway/http.ts` | consent and OAuth HTTP endpoints |
| `gateway/main.ts` | loopback WebSocket gateway |

Future modules: notifications, file service, AGENTS.md editor, search, UI for approvals/questions/Plan Mode/permissions, worktree. Do not scatter these concerns into `App.tsx`.
