# Independent scheduled tasks (CodexMobileUI)

## Architecture

The scheduler is owned by the **per-computer Gateway process**, not Android, the
browser, or Codex Desktop. Android and a future authenticated web client send
the same `automation/*` JSON-RPC methods over the already authenticated Gateway
WebSocket `/connect`. Every task belongs to exactly one host and a native Codex
project on that host. There is no cross-host implicit execution or shared disk.

The Gateway keeps an SQLite database at `.state/scheduler.sqlite`; it contains
task prompts, run status, timestamps, native thread IDs, and unread state. This
file is private and excluded from Git. Never serve it as a static asset or put
task contents/IDs into diagnostics. The Gateway's embedded scheduler connects
**directly to the dedicated, loopback-only App Server** using a separate
initialized native WebSocket. It never opens or starts the Desktop UI.

Tasks run only while the owning Windows computer, private App Server, and
Gateway are online. Existing host lifecycle scripts own these processes. If
offline at the scheduled minute, missed occurrences are recorded but not
replayed in a burst. Each host owns its local scheduling clock; schedules have
an IANA timezone, and calendar triggers are calculated in that zone.

## Client contract (v1)

`shared/automation.ts` contains transport-neutral `TaskInput`, `Task`,
`TaskSchedule`, and `TaskRun` types; neither Node nor React imports are needed
by a browser client. Send the following over the **authenticated** Gateway
WebSocket, with normal JSON-RPC `id`, `method`, and `params` envelopes:

| Method | Params | Result |
| --- | --- | --- |
| `automation/list` | `{}` | `{data: Task[]}` |
| `automation/create` | `{task: TaskInput}` | `Task` |
| `automation/update` | `{id, patch}` | `Task` |
| `automation/toggle` | `{id, enabled: boolean}` | `Task` |
| `automation/delete` | `{id}` | `{ok: true}` |
| `automation/run` | `{id}` | `TaskRun` (accepted, not finished) |
| `automation/runs` | `{taskId}` | `{data: TaskRun[]}` |
| `automation/inbox` | `{}` | `{data: TaskRun[]}` unread results |
| `automation/read` | `{runId}` | `{ok: true}` |

Use `project/list`, `thread/list`, `model/list` from the **same selected host**
for live selectors; never hardcode a model catalog or send arbitrary host file
paths from the client. Creation/update validates the live native project and
model/effort catalog. `conversationMode: 'new'` creates a new native thread
every run; `resume` uses `threadId` or creates one on the first run and stores
its ID for later runs. The task list and run history are authoritative server
state, not client-side preferences. To view a result, open its native `threadId`
on the run's host.

Recurrences: `once`, `hourly`, `daily`, `weekdays`, `weekly`, or a restricted
`rrule` variant supporting `FREQ=HOURLY|DAILY|WEEKLY`, bounded `INTERVAL`,
`BYDAY`, `BYHOUR`, `BYMINUTE`. Unsupported RRULE grammar is rejected, not
silently misinterpreted. Advanced options are not full RFC 5545 support.

## Unattended safety and reliability

The runner uses only the native `:read-only` or `:workspace` named permissions
profiles and `approvalPolicy: 'never'`; it **never auto-approves privileged
operations**. App Server approval requests are denied. Worktree mode requires
a valid Git repository at the native project's root and creates a *persistent*
detached worktree under `.state/automation-worktrees/<task-id>/`, whose edits
are not automatically reset, committed, merged, or deleted.

Only one run of a task is active at a time. A runner cannot safely re-submit an
ambiguous native `turn/start` call. Gateway restarts mark in-flight runs as
`interrupted`, preserving their native thread ID for manual inspection. A failed
run is visible in the result inbox; manual `run` does not alter a task's next
scheduled occurrence. A one-shot run moves the task to completed status at
the scheduled trigger, even if its native execution later reports failure.

## Deployment and remaining validation

- Gateway is compiled with `npm run build:gateway` and launched using the
  existing owned `scripts/gateway-only.ps1` workflow; App Server continues to
  use `scripts/mobile-app-server.ps1` and its isolated `CODEX_HOME`.
- Run `npm run typecheck:gateway`, `npm run typecheck`, and `npm run test` before
  updating Gateway. Sandbox child-process restrictions can skip the isolated
  Git worktree integration test; use a dedicated safe integration environment
  to verify its Node-to-Git execution path.
- Verify Android UX on device, OAuth and reconnection, real scheduled native
  turns, paused/completed states, and wake-from-reboot handling before
  depending on unattended automation.
- The `web/` React/Vite app is currently a local **visual prototype**; the
  authenticated web coordinator/client is not yet implemented. When built,
  the web client must use the same `automation/*` API and shared types, not
  a browser-side timer or a second scheduler. Do not claim the web prototype
  has live task-management capabilities yet.
- Synchronize Gateway changes to each remote computer (e.g. noha) through a
  reviewed Git deployment. Do not copy `.state`, `.env`, secrets, Codex homes,
  or another computer's task database between hosts.
