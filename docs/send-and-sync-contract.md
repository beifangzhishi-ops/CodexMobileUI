# MobileUI sending and synchronization contract

This contract is intended for both Android and the future multi-host web client.
The server's native thread history is authoritative. A local chat bubble is not
proof that a native turn was accepted.

## Message submission

1. On Send, lock the send button and show its spinner. Leave the draft in the
   composer while establishing a connection; do not create a local bubble yet.
2. If connection establishment fails, unlock the button, report failure and
   leave the draft untouched. The user explicitly retries.
3. Once connected and ready to submit, stage the local message bubble, clear
   the visible composer and show **正在发送** on the bubble.
4. Keep the button spinning until the native turn/steer/queue RPC acknowledges
   acceptance or reports a failure. Acknowledgment does not mean the task
   finished. On acceptance, hide the temporary delivery label.
5. On an ambiguous failure after stage 3, show **发送失败 · 刷新核对** on the
   local bubble. Do not automatically replay the RPC or repopulate the composer:
   the server might already have accepted it. For a first turn, its native
   thread creation may separately be ambiguous.
6. Manual pull-to-refresh must connect if necessary, fetch authoritative lists,
   then read the selected thread. A server user item with the accepted turn ID
   replaces its optimistic bubble. For older messages without a known turn ID,
   match original wire text (excluding non-text image parts); occurrence counts
   handle identical follow-ups. After a **successful authoritative** read,
   remove accepted/failed local-only bubbles absent from server history.
   Never clear them merely because an offline/cache-only refresh failed.
7. A visible send-button spinner prevents repeat taps until the server replies
   or the request fails. After failure, an explicit user retry is permitted;
   there is no automatic resend or additional post-failure duplicate lock.

8. While a native turn is running, an empty composer shows Stop, and a
   nonempty composer shows Send (steer/queue). Both actions show the same
   request-in-flight spinner until acknowledgment, but a terminal native turn
   event immediately supersedes a pending Stop spinner. A Stop RPC is always
   tied to both the selected thread and its exact turn ID; a late response must
   never interrupt a subsequently started turn. If Stop races with a natural
   completion, refresh native state and silently accept the completed turn.

## Attachments

- Upload chunks receive a cumulative `received` byte count from the authenticated
  Gateway. Display `received / total` rather than estimated or transmitted bytes.
  The last 100% of bytes is not equivalent to attachmentFinish confirmation.
- Native `userMessage` may contain text and `localImage` in one item. Preserve
  that single user item and present the image as a previewable attachment.
- Uploaded file references embedded in the documented native turn text are
  displayed as file cards, not as host filesystem paths. Preserve raw turn text
  for reconciliation and cache attachment metadata for offline presentation.
- `workspace/attachmentRead` is an authenticated, chunked read of existing
  host-generated managed files only, not general host filesystem access.
- Store an acknowledged uploaded attachment under the phone's private documents
  directory, keyed by host and Gateway-generated UUID filename. Local preview
  never requires a live socket when that private copy is readable. An absent or
  unopenable copy falls back to the authenticated Gateway read, replaces the
  damaged copy, and retries the preview once. No arbitrary host path is exposed
  or read as a generic filesystem operation.

## Connectivity and task status

- Browse local cached history without a socket. Initial and foreground sync are
  opportunistic; pull-to-refresh is the explicit recovery action.
- The active host may keep a WebSocket for notifications while tasks run.
  Suspend it in the background or after two minutes of foreground inactivity
  without running work; reconnect when an action needs it.
- Passive hosts use short-lived index connections, not long-lived WebSockets.
  A successful metadata sync means **cached**, not permanently online.
- Transport loss must not mark a running native task as complete. Mark state
  pending synchronization until a fresh native thread/read establishes the
  actual task status. Missed transient streaming deltas cannot be reconstructed
  unless exposed in native history.
- Approval controls and other server mutations must rely on current transport
  state, never on cached approval prompts or inferred remote readiness.

## Safety limitation

The current optimistic bubble is held in React state, while the pre-acknowledged
draft remains in local persistent storage. If the application process is killed
during an ambiguous send, the user should refresh native history before
resubmitting any restored draft. No auto-resend mechanism is provided.
