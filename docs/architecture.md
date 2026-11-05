# CodexMobileUI system architecture

## Source of truth

- **Windows Codex App Server**: native thread/turn/item history, model settings, approvals and canonical project objects/assignments.
- **Android SQLite**: cached thread/project snapshots, viewed messages, local unsent selections/drafts and retry-bounded automatic-title jobs. Never invent persistent Codex thread IDs.
- **Android SecureStore**: per-host OAuth access and refresh tokens. No hardcoded client secret.
- **Host gateway**: owner-authenticated HTTPS/WSS entry point with one-to-one relay to loopback shared Codex App Server. The gateway is a different service from CCM.

## Data flow

1. Owner enters host HTTPS origin (6v or noha); app checks existing SecureStore session.
2. If no session, system browser opens host OAuth Authorization Code + PKCE S256 flow; owner enters locally configured consent secret. Browser returns a one-time code; Android exchanges the code, stores tokens securely.
3. App opens WSS `/connect`, supplies an access token as the first JSON message, and gateway validates it **before** opening the upstream Codex socket. A successful reply is `{type:"ready"}`.
4. App sends Codex `initialize` / `initialized`, then `thread/list`, `thread/resume` and `thread/read`. The gateway passes these messages through unchanged to the existing localhost shared Codex App Server.
5. Mobile receives native Codex events, displays new text and reconciles stable thread/turn/item history on completion. A dropped connection triggers reconnect; committed messages are retrieved from Codex, deduplicated and stored locally.
6. When offline, already cached messages remain readable and the composer persists a draft. The draft **never automatically sends** after reconnect.

The thread list requests `modelProviders: []` to include all model providers recorded by Desktop, retains cursor pagination and fails closed on bad pages. The phone reads canonical projects from `project/list`, not from a scan of thread working directories. Thread grouping prioritizes server `projectId` and falls back to longest matching registered project root when the ID is missing; unmatched threads remain uncategorized.

New conversation navigation is a local pending selection and a locally cached unsent draft, **not** a Codex thread. An empty pending selection never creates a server thread or directory. On first send for a project the phone calls `thread/start {cwd,projectId}` then `turn/start`. For an explicit projectless conversation the authenticated Gateway uses `workspace/prepare` to call native App Server `fs/createDirectory` and `fs/getMetadata` for a fixed, server-derived `Documents/Codex/MobileUI/YYYY-MM-DD/<draft-id>` directory, then uses its cwd for thread creation. Failed `turn/start` retains the real thread ID and draft; ambiguous creation is not silently retried. No completed message is fabricated in SQLite.

Moving a thread calls `thread/metadata/update` and re-reads canonical assignment without changing cwd or moving any filesystem contents. The Desktop sidebar can maintain a separate assignment cache, so the phone monitors for server reversion but never forces perpetual rewrites. Automatic naming is triggered only for MobileUI-originated threads with a completed first turn and no existing name; an ephemeral read-only title thread generates a short structured result and `thread/name/set` persists it. Both project and projectless chats use the same planned file interaction stack.

## Trust boundaries

- Public Funnel routes must terminate at the **authenticated** gateway, not at the app server or model proxy.
- OAuth credentials apply only to the selected host and do not constitute authority to read arbitrary filesystem paths.
- Each future endpoint needs host/thread/cwd-level authorization, path canonicalization, upload size enforcement and event correlation.
- The gateway enforces an explicit native RPC allowlist with strict parameter validation for project reads, thread reassignment and naming. The gateway-only workspace operation chooses a fixed host path and calls native filesystem RPCs internally; arbitrary `fs/createDirectory` requests from mobile are rejected. Unknown privileged requests are rejected before reaching the shared App Server. Mobile turn creation can nevertheless cause privileged host-side Codex tool execution, so owner OAuth approval is highly privileged; there is no public signup or multi-user separation.
- OAuth approval is local-host-specific; code challenge and redirect URI are exact-match; codes are short-lived and one-time; tokens are stored as hashes on disk.
- Access/refresh tokens must never occur in URL parameters, logs, Git or reports. Consent secret is local environment input, not committed.

## Operational limits today

**Validated (2026-11-05):** Existing native App Server read-only `initialize` / `thread/list` / `thread/read` on both hosts, and real Android 0.1.2 OAuth, WSS, thread reads, `turn/start`, turn completion notifications and post-turn snapshots on 6v. The 6v diagnostic export shows successful real Codex RPC exchanges; it does not prove every text-rendering or keyboard interaction. Read-only all-provider probes returned 181 interactive threads on 6v (versus 2 with the default provider filter) and substantially more on noha. Unit and integration tests cover protocol parsing, gateway relay, authorization and the new listing/new-thread helpers.

**Protocol validated on both hosts (2026-11-05):** `project/list` returned real projects (6v: 12, noha: 11). Dedicated disposable test threads successfully started with a native `projectId`, moved with `thread/metadata/update`, and returned the target project in `thread/read`; both were deleted afterward. `fs/createDirectory` and `fs/getMetadata` were verified with isolated test paths and cleaned. Desktop sidebar synchronization after mobile reassignment is not yet verified.

**Not yet device-validated:** This revision's delayed first-send handling, project selection/moving UI, automatic title job, per-host projectless cwd, noha phone login, extended streaming/offline recovery, keyboard focus, multi-client approvals, local notifications and complete file access. Real-device verification must not be inferred from TypeScript/unit tests or protocol probes.

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
