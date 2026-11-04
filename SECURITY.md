# Security

This repository has **no public account registration** and no hosted access service. It is intended for self-hosted personal use, but all source should be safe to publish.

Do not place real host names or Funnel URLs, OAuth approval secrets, refresh tokens, access tokens, Code/Codex/CMP credentials, Android signing keys, device backups, private transcripts or Windows file paths into commits or issue reports.

The HTTP gateway listens on loopback only, behind an independently configured HTTPS Tailscale Funnel on port 8443. Funnel is public to the internet, but unauthenticated WebSocket requests cannot reach the backend. After host-secret approval and OAuth PKCE, an explicit native RPC allowlist permits only the current mobile UI operations: initialize, thread listing/reading/resuming/creation and turn creation. All other client RPC methods are rejected before upstream forwarding. **turn/start can still cause Codex to run privileged tools using the host's own permissions.** Treat a successfully authorized phone as highly privileged. Do not share its approval secret or refresh tokens.

Access-token expiry, one-time PKCE codes, refresh rotation and local token revocation are implemented. These measures do **not** replace endpoint authorization for future file APIs. Recheck filesystem paths, content types, thread scope and size limits on the host.

When filing security issues, describe a minimal sanitized reproduction without endpoint secrets or live authorization traces. Report vulnerabilities privately to the repository maintainers rather than posting exploits against a live public endpoint.

The mobile diagnostic export feature records only a bounded set of allowlisted events and scalar fields in a local, app-private SQLite database. It deliberately does not record OAuth authorization codes, PKCE verifiers, tokens, secrets, host origins, user messages, file paths, full error messages, native stacks, thread identifiers or network payloads. The user must explicitly select **日志 → 导出 JSON 日志（系统分享）** to hand a copy to another application. Diagnostic JSON may still reveal app version, device OS version, timestamps, activity and error categories; review the file before sharing it publicly. Logs are limited to approximately 1,800 events or 7 days and can be cleared in the app.
