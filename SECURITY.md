# Security

## Current deployment

The shared Web, Android and Electron clients connect to a self-hosted Coordinator over a private Tailnet. Keep the Coordinator, peer Agent, Gateway and Codex App Server on their intended private/loopback interfaces and restrict access to trusted devices. Do not expose the Coordinator using a public reverse proxy or Tailscale Funnel. Access to the private client may permit actions with the host's Codex permissions; network membership is therefore a meaningful trust boundary.

Keep actual credentials and signing keys out of Git. Use per-host local configuration, generate unique secrets, and never reuse example values. The repository's public source, license and maintenance notes do not grant access to any running instance. Do not treat private host examples in the development history as your deployment configuration.

## Historical OAuth gateway notes

The following describes the earlier mobile OAuth/Funnel design. It is retained for reference, not as the recommended current deployment topology.

This repository has **no public account registration** and no hosted access service. It is intended for self-hosted personal use, but all source should be safe to publish.

Do not place real host names or Funnel URLs, OAuth approval secrets, refresh tokens, access tokens, Code/Codex/CMP credentials, Android signing keys, device backups, private transcripts or Windows file paths into commits or issue reports.

The HTTP gateway listens on loopback only, behind an independently configured HTTPS Tailscale Funnel on port 8443. Funnel is public to the internet, but unauthenticated WebSocket requests cannot reach the backend. After host-secret approval and OAuth PKCE, an explicit native RPC allowlist permits only the current mobile UI operations: initialize, thread listing/reading/resuming/creation and turn creation. All other client RPC methods are rejected before upstream forwarding. **turn/start can still cause Codex to run privileged tools using the host's own permissions.** Treat a successfully authorized phone as highly privileged. Do not share its approval secret or refresh tokens.

Access-token expiry, one-time PKCE codes, refresh rotation and local token revocation are implemented. These measures do **not** replace endpoint authorization for future file APIs. Recheck filesystem paths, content types, thread scope and size limits on the host.

When filing security issues, describe a minimal sanitized reproduction without endpoint secrets or live authorization traces. Report vulnerabilities privately to the repository maintainers rather than posting exploits against a live public endpoint.

The mobile diagnostic export feature records only a bounded set of allowlisted events and scalar fields in a local, app-private SQLite database. It deliberately does not record OAuth authorization codes, PKCE verifiers, tokens, secrets, host origins, user messages, file paths, full error messages, native stacks, thread identifiers or network payloads. Export is always an explicit user action: **日志 → 保存 JSON 日志到下载目录** (Android 10+) writes to shared device storage; **通过系统分享日志** hands a copy to a chosen app. Shared Downloads files remain after the private journal is cleared and may be visible to file managers and other authorized apps. Diagnostic JSON may still reveal app version, device OS version, timestamps, activity and error categories; review the file before sharing it publicly. Logs are limited to approximately 1,800 events or 7 days and can be cleared in the app.
