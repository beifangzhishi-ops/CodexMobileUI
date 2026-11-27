# Independent scheduled tasks (CodexMobileUI)

## Architecture

The **per-computer Gateway process** owns the scheduler. The shared Web UI
sends `web/automation` through the private Web Bridge, which calls
`automation/*` over the authenticated Gateway WebSocket `/connect`.
Every task belongs to exactly one host. Model tasks also belong to a native
Codex project on that host. Execution and reminder storage are host-local.

The Gateway keeps an SQLite database at `.state/scheduler.sqlite`; it contains
task prompts, run status, timestamps, native thread IDs, and unread state. This
file is private and excluded from Git. Never serve it as a static asset or put
task contents/IDs into diagnostics. The Gateway's embedded scheduler connects
**directly to the dedicated, loopback-only App Server** using a separate
initialized native WebSocket. It never opens or starts the Desktop UI.

Model tasks require the owning Windows computer, private App Server, and
Gateway. Existing host lifecycle scripts own these processes. For model
tasks, missed occurrences are recorded and skipped. Each host owns its local
scheduling clock; calendar triggers use the task's IANA time zone.

Select **不使用模型（仅提醒）** in the task editor to create a reminder on the
selected host. It needs a title, reminder text and a schedule. At trigger time
the Gateway stores the reminder in the task inbox and advances the schedule in
the same transaction. The reminder path makes no native RPC or model call. The
Gateway emits at most one overdue reminder per task on recovery and records its
original due time. **立即提醒** creates an inbox entry immediately and preserves
the next scheduled time.

The Coordinator polls a bounded, authenticated feed for each registered host
and reuses the existing notification stream. Remote reads go through the
registered Web Agent with its own peer credential. Each host's Web service
reads its Gateway over loopback using a separate local token. Neither feed
connects to the App Server. Browser and supported Android system notifications open
the reminder record. Task management still uses the existing Web host
connection. With system notifications disabled, the record is available in the
task inbox.

## Client contract (v1)

In a newly created project chat, Codex can call `schedule_task` in response
to an explicit request to schedule work. The host's Web Bridge registers the
tool with the native App Server and resolves the originating thread and its
project before sending the task to the existing Gateway. The tool can schedule
one saved task per interactive turn, use the current conversation or start a
new conversation per run, and returns the saved task ID and next run time.
Model-created tasks use a read-only permission profile. The shared task page
and `schedule_task` can use the host defaults or explicitly select a model
and one of its supported reasoning efforts. Codex can call
`list_schedule_models` to discover the current host catalog. The shared task
page can edit or pause a saved task.

The native runtime registers dynamic tools when the thread starts. Chats
created before the tool was added and chats without a project do not support
this entry point. Chats with the original tool schema can still create tasks
with default model settings. Create a new project chat to register the model
catalog tool and the expanded creation schema. Scheduled turns cannot create
tasks through the chat tool.

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
model/effort catalog for model tasks. `modelMode: 'none'` selects a reminder;
the existing default-model value remains `model: null`. For model tasks,
`conversationMode: 'new'` creates a new native thread
every run; `resume` uses `threadId` or creates one on the first run and stores
its ID for later runs. The task list and run history are authoritative server
state. Results with a native `threadId` open the run's chat; reminder records
open in the task page with the saved title and text.

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
- Verify Android UX on device, private Tailnet reconnection, real scheduled native
  turns, paused/completed states, and wake-from-reboot handling before
  depending on unattended automation.
- Deploy the compiled Gateway module and the host-only Web Agent entry to
  noha together. Keep each host's scheduler database and Codex home local.
