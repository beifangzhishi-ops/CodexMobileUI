# CodexMobileUI tool activity & reasoning summaries

The authenticated Gateway forwards native Codex App Server notifications without
interpreting or synthesizing the conversation. The phone maintains one canonical
list of server item IDs for each turn; its SQLite cache is rebuilt from
`thread/read` snapshots.

## Native data

- `item/started` and `item/completed` identify and finalize tool items.
  The completed item is authoritative over earlier deltas.
- `item/commandExecution/outputDelta` updates the existing command output.
- `item/reasoning/summaryTextDelta` appends public summary sections indexed by
  `summaryIndex`. Raw `item/reasoning/textDelta` and `reasoning.content`
  are deliberately never displayed as reasoning summaries.
- `item/plan/delta` is streamed and recovered from native plan items.
- `thread/read` includes server items in their canonical turn/item order.
  Native history is the baseline, but some native execution items have sparser
  history than their earlier notifications. On reconnect/refresh the phone
  merges only previously observed real item IDs from the same native turn;
  it never invents an assistant command or treats socket status as an item.
  A final server-provided output wins over earlier streamed fragments.
  SQLite stores committed tool/summary metadata separately from text, including
  bounded native command output captured in earlier notifications.
- Out-of-order command output deltas establish a temporary native-ID-based
  command row. The later `item/started` supplies its actual command and
  `item/completed` supplies terminal status without dropping earlier output.
- `fileChange.changes[].diff` is removed by the authenticated Gateway from
  forwarded notifications and `thread/read` snapshots. File paths and status
  remain; diff text is neither sent nor rendered on the phone.

## Compact mobile presentation

- Readable summary text appears inline between tool calls and responses; long
  summaries expand on demand.
- A single command, MCP call or file change shows an understated status line,
  a short preview and optional expanded details. In-progress tools show a
  spinner, and failures/nonzero exit codes are marked visibly.
- Only **adjacent** `commandExecution` items (or adjacent `fileChange`
  items) in the **same turn** form a collapsible group. A reasoning summary,
  response, a different tool type or turn boundary always breaks the group.
- In Desktop `STEPS_COMMANDS` presentation, grouped commands start expanded
  so that each command is visible; the output/detail of an individual command
  remains expandable for a narrow Android screen.
- Groups exist exclusively in `src/ui/activityGrouping.ts`; no synthetic
  group ID is sent to Codex or persisted as an authoritative message.
- Search covers item titles, previews and expanded details. All merged items
  remain individually inspectable and in their original order.

## Verification

Run `npm.cmd run check` and `npm.cmd run build:gateway`.
`tests/activity-protocol.test.ts` covers snapshot recovery, summary streaming,
out-of-order command output, terminal status, sparse-history reconciliation,
final-item replacement, failure highlighting, turn isolation and grouping.
The native App Server can omit some Desktop-internal tool kinds from its
supported read RPC. This client shows the native data it actually receives;
it does not silently claim byte-for-byte parity with Desktop private rollouts.
A physical Android acceptance pass is still required for scrolling, expansion,
branch navigation and real-time server events.
