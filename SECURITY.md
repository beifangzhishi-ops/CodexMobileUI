# Security

This repository has **no public account registration** and no hosted access service. It is intended for self-hosted personal use, but all source should be safe to publish.

Do not place real host names or Funnel URLs, OAuth approval secrets, refresh tokens, access tokens, Code/Codex/CMP credentials, Android signing keys, device backups, private transcripts or Windows file paths into commits or issue reports.

The HTTP gateway listens on loopback only. Its current proxy relays native Codex RPC methods, including potentially powerful filesystem and tool operations, after successful OAuth authentication. **This is highly privileged access. Do not expose the gateway until you have tested and accepted its permission boundary.**

Access-token expiry, one-time PKCE codes, refresh rotation and local token revocation are implemented. These measures do **not** replace endpoint authorization for future file APIs. Recheck filesystem paths, content types, thread scope and size limits on the host.

When filing security issues, describe a minimal sanitized reproduction without endpoint secrets or live authorization traces. Report vulnerabilities privately to the repository maintainers rather than posting exploits against a live public endpoint.
