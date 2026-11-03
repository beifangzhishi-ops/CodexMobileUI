# CodexMobileUI repository rules

## Purpose and authority
- Personal-use Android app for the actual shared Codex App Server of 6v/noha. Native Codex thread IDs and persisted turns remain authoritative. The Android SQLite DB stores caches, upload references and local unsent drafts; never create a competing chat state machine.
- Keep the project safe to publish openly. No secrets, real host URLs/IPs, passwords, OAuth tokens, signing keys, local user data or personal chat transcripts may enter source, docs, logs, fixtures, Git or release assets.
- This is staged implementation. Every feature must be described as tested or untested accurately; do not present mock or compile-only behavior as a validated Android APK.

## Architecture and scope
- Maintain strict modules for `src/core` protocol/transport, `src/session` synchronization and state, `src/storage` SQLite, `src/auth` PKCE/token storage, `src/ui` RN assistant-ui and rendering, `gateway` authentication and local Codex relay, and `tests`.
- Never make the app depend on CCM/AOI; they are protocol references only. Do not modify CCM, AOI, the shared Codex proxy, or production authentication services without distinct user approval.
- Treat network payloads, model text, file URIs and all external links as untrusted. Never execute remote HTML/script or expose arbitrary Windows paths. Use authenticated HTTPS/WSS with host/thread/resource checks for all new endpoints.
- Preserve genuine App Server protocol and native messages; when live events are dropped, recover from authoritative `thread/read` rather than blindly replaying text. Correlate by thread/turn/item IDs and keep locally drafted text from silently auto-sending.
- Review backwards compatibility and any changes to settled architecture with the user before implementing. Remove superseded names and dead files; do not keep inactive compatibility shims by default.

## Quality, tests, documentation
- Before changes, read this AGENTS.md, then README.md and relevant module contracts.
- Run `npm run check` and appropriate native/manual checks before marking work complete. Tests must never contact private real hosts or use actual OAuth secrets; use ephemeral loopback test servers.
- Maintain README.md and AGENTS.md with actual current behavior. Keep architecture and roadmap docs consistent. Explicitly mark any feature that lacks real-host or Android-device validation.
- Use stable Android package identity `dev.codexmobileui.app`. Keystores, credentials, local runtime state and per-machine configuration are not tracked.
- For a Git repository, commit finished verified work. Push to existing configured remote only; never create or publish a public remote without separate authorization, never force push.

## Shared Windows launchers
- The independently bundled shared-stack scripts in `scripts/` must maintain protocol and behavior parity with the AOI launcher across 6v/noha. This is source synchronization only, never a runtime dependency on AOI.
- A shared stack is owned only by the checkout that started its proxy and backend. Other checkouts may hot-attach after port, readiness, and process-identity checks; they must not adopt PID files, restart, or stop foreign processes.
- Shared-stack first-start/stop uses a cross-checkout Windows mutex; Gateway startup has a separate mutex and process ownership. Never auto-stop active Desktop, AOI, mobile clients, or shared work on launcher exit.
- Gateway remains loopback-only. Do not configure or enable a live Funnel endpoint without a distinct security review and explicit user authorization. Do not claim a health endpoint proves authenticated mobile or multi-client approval correctness.
