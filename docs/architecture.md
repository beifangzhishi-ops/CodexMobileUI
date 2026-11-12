# CodexMobileUI system architecture

## Web browser frontend (visual prototype)

`web/` is an independent React/Vite frontend, separate from Android/Expo and the per-host OAuth Gateway. It renders clearly identified fictional hosts, projects and conversations; its local send action does not invoke a model. No browser API client, real server credentials or Tailscale route exists in this milestone.

The next step is an authenticated web coordinator reachable through private Tailscale Serve, which binds each request and approval to a specific host and thread and routes to each host's authenticated Gateway. Keep the raw native App Server socket bound to loopback, keep host `CODEX_HOME` databases independent, and leave the existing Android/Funnel deployment unchanged unless specifically authorized.

## Authority and separation

- The dedicated Windows Codex App Server owns genuine threads, projects, turns, model settings and approvals.
- Android SQLite owns cached snapshots, title jobs, diagnostic history and unsent drafts. `src/storage/profile.ts` namespaces conversation data for the private backend so previous mobile caches cannot surface as current sessions.
- Android SecureStore owns OAuth tokens for connecting to a specific host Gateway; these are not native Codex model credentials.
- The independent native `CODEX_HOME` is `%LOCALAPPDATA%\CodexMobileUI\CodexHome`. This profile is not populated with another Codex installation's sessions, settings, tokens or locks.
- Only the verified executable/runtime package is sourced from the installed Codex Desktop kernel family, copied to an immutable fingerprinted directory in `.runtime/mobile`. No Desktop UI or external compatibility proxy is involved.

## Network and process topology

```text
Android + SecureStore -- HTTPS/WSS :8443 --> Tailscale Funnel
                                            |
                                  OAuth Gateway (127.0.0.1:48888)
                                            |
                                  Native App Server WS (127.0.0.1:45891)
                                            |
                                  CODEX_HOME private persistent folder
```

`scripts/mobile-app-server.ps1` is the only backend process lifecycle owner. `scripts/gateway-only.ps1` independently manages Gateway. `scripts/mobile-launcher.ps1` sequences startup and shutdown, while `Login-CodexMobile.cmd` allows separate interactive native authentication. Neither entry manages another application's processes. No native filesystem or model socket is directly published to Funnel.

Native protocol: JSON-RPC `initialize` / `initialized`, cursor-paginated `thread/list` and `project/list`, `thread/resume`, `thread/read`, `thread/start`, `turn/start`, `thread/metadata/update`, `thread/name/set` and typed native turn/item notifications. The Gateway forwards only allowlisted methods and validates constrained write requests.

## Conversation lifecycle

Blank chat selection is local only. On the first actual send for a project, the phone passes an existing root plus native `projectId` into `thread/start`, then `turn/start`. For an explicit projectless chat, the authenticated Gateway chooses a fixed host-owned work path and calls native `fs/createDirectory`/`fs/getMetadata` before thread creation. Pending IDs and drafts are persisted; ambiguous commits are never silently replayed.

Projects and threads are isolated by native `CODEX_HOME`. No old project list is imported into the private profile. Real project moves change project metadata only, not cwd or disk files. A bounded ephemeral title thread generates a structured short title without polluting conversation history or overriding manual names.

The mobile cache host key has a dedicated profile namespace, independent of OAuth host IDs. Old Android cache records remain physically intact but are not loaded for the independent backend.

## Trust boundaries

Only authenticated HTTPS/WSS reaches the Gateway. OAuth PKCE binds the browser callback and one-use code; refresh tokens rotate and secrets stay private. The Gateway rejects unknown native RPC and arbitrary host filesystem paths. A permitted turn can run privileged tools subject to Codex sandbox/approval. Choosing cwd is not a filesystem isolation guarantee. No confidential data belongs in source, tests or diagnostics.

## Verification status

TypeScript and host contract tests check the source. They do not establish actual new-backend startup, native model authentication, on-phone login, full streaming, Windows filesystem restrictions or Desktop session behavior. Those require controlled runtime tests on each host and a real Android device. Current work preserves the owner's normal Desktop environment.
