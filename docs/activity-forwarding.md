# CodexMobileUI native conversation activities

The browser, Android WebView and Electron share web/src. Native thread/item IDs,
turn ordering, actual runtime status and permissions remain authoritative on
the owning App Server; none of the following creates artificial chat history.

## Activity display

- Native reasoning summaries and explicitly returned display text are separate
  fields. Summary is visible; additional native text starts collapsed. Streaming
  sections use summaryIndex/contentIndex and the native turn/item identity.
  Encrypted or omitted content is not decoded or reconstructed. A sparse
  snapshot can retain only text previously delivered to the same live client
  for an item the native history still contains; a page reload cannot recover
  text absent from the native history.
- Native subAgentActivity records (started, interacted, interrupted, completed)
  start as compact single rows and expand into an independently scrolling live
  activity timeline, with real agentPath, model and effort when present.
  A read-only detail request verifies that the parent history actually refers to
  the requested agentThreadId before retrieving the child on the same host.
  The verified active child receives native item/turn events with bounded
  snapshot polling as a recovery path. Recent entries are accumulated rather
  than replaced by the last few items. The timeline follows its newest activity
  using the shared chat scrolling behavior; scrolling up pauses follow and
  the jump-to-latest control resumes it. Explicitly collapsing an expanded
  child also returns its containing main or side chat to the latest message
  and resumes its follow mode. Child messages remain separate from
  the parent. Full history remains an explicit read; a failed read is not
  replaced with fabricated content.
- Command, plan, tool and compaction activities keep the native IDs. The final
  server item is authoritative when it provides text. Failures are understated
  but visible. The UI does not treat socket acknowledgment as task completion.

## Custom permission choice

The shared client stores a bounded per-host/per-thread display preference in
its local browser profile. The SHA-256 fingerprint includes the confirmed
native profile, reviewer, approval policy and sandbox semantics; raw policy
objects and credentials are not written to localStorage. Reopening reads
native settings and only restores the custom label if the fingerprint matches.
A changed native permission is shown as the actual current setting, with a note
that the last choice was custom. Selecting a preset clears the old preference.
Opening a thread never reapplies config.toml or grants permission. Preferences
are per client profile, not a host-wide authorization record.

## Context compaction

The existing context circle opens its popover on an established thread even
before a token-usage notification is available. The popover contains the
graphical compact action. No slash-command menu, init, reload, synthetic
summary prompt or user message is added. The native RPC is
thread/compact/start with only threadId. The client checks native history,
queue and in-flight sends, disallows duplicate starts, observes a new
contextCompaction item and its matching terminal turn, and uses native token
usage for the updated ring. On ambiguous disconnect/timeout the client requires
a read-back check rather than automatically retrying. Native history stays visible.

## Side Chat

The official installed desktop uses durable attached forks for supported
paginated local sessions: thread/fork with attachToSource=true and
excludeTurns=true, and thread/list with attachedToThreadId for discovery.
MobileUI uses this native relationship and never substitutes a normal fork or
injects parent history as a user prompt. Legacy/unsupported source histories
fail closed instead of creating an ordinary conversation. The server inherits
source context and permissions; the attached thread has its own visible turns.
New forks receive one fixed trusted developer-instruction policy. It treats
inherited history as reference only, permits read/search and non-mutating
checks, prohibits creating or interacting with subagents, and limits mutations
to actions explicitly requested in the side chat. Browser clients cannot
override this policy. Existing side chats created before this change have no
retroactive coverage because the current native protocol exposes the policy
only at fork creation.

The main chat has a graphical entry. Wide screens open a right-hand panel;
narrow screens open a full-width returnable panel. It can open while the main
turn runs. The side composer, drafts, messages, stop target and native status
are independent. Attached conversations are omitted from the main sidebar.
Multiple attached chats may be selected or created; closing the panel does not
stop or delete either chat. Selected main-message text can be placed into a
visible editable side draft. The current side composer supports text; it does
not introduce a separate attachment or permission-settings implementation.

## Verification

2026-11-24: both private native App Servers reported 0.171.0-alpha.13.
On 6v, a disposable native conversation produced a real compaction activity,
terminal completed event and persisted item; attached fork was independently
listed and its visible history started empty. A separate 6v test dispatched
the attached fork on parent turn/started and received its acknowledgment
before the parent completed. On noha, a disposable attached conversation
answered a marker inherited from the parent, had its own one-turn history,
matched the parent's effective read-only profile/sandbox/reviewer/policy,
had no inherited Goal, and a parent compaction completed. All created test
threads were removed. No real user thread was mutated.

Root checks, Gateway compilation, Web build/tests and Desktop tests passed.
A headless Chromium harness using mock native data passed the five graphical
controls at 1280 and 390 px: reasoning expansion and child history, one compact
request with 67% to 15% native fixture usage, custom permission selection after
reload, one attached side creation and independent reply, no sidebar leakage.
The narrow overlay stacking issue discovered in the first screenshot pass was
fixed and rechecked visually. Actual Android device installation remains a
separate acceptance step. Tests live in web/tests/conversationControls.test.mjs
and tests/rpc-policy.test.ts.
