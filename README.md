# CodexMobileUI

## Composer and turn errors

The shared new-chat menu shows the selected host and project. The attachment
menu opens the system image picker from Photos. Android builds configure
WebView to open that picker directly without offering camera capture.

Conversation history displays native turn failures, including errors recovered
from `thread/read`. During a running turn, consecutive reconnect notices update
one row. The terminal turn event replaces or clears that row.

## Conversation titles

The shared chat UI shows up to 60 characters of first-message preview while
an unnamed conversation waits for its title. The host title task uses the
language of the first message and accepts a title of up to 36 characters.
Attachment-only first messages keep the default label. Existing names take
precedence over automatic titles and previews.

## Private HTTPS and browser task notifications

The Web Coordinator is served by private Tailscale Serve on HTTPS port 4190.
Open **电脑与设置 → 浏览器任务完成通知** in the browser and grant site
notification permission. The tab must stay open for live pop-ups. Reopening
it can recover missed completion events from the existing private feed.
Existing Android builds require an update to enter the HTTPS address.

## 2026-11-23 Android private task completion notifications

The Android WebView shell now has an opt-out native foreground service for
private-network task completion notifications. It opens one outbound WebSocket
to the existing 6v Coordinator through FlClash's Tailscale outbound route;
no incoming mobile listener, public Funnel, Firebase, Expo Push or additional
VPN configuration is required. A low-priority ongoing notification indicates
the listener state, while native turn completion notices identify 6v/noha,
the conversation title (when available), the terminal status, and a bounded
preview of the final assistant message from the exact completed turn. Android
uses expanded BigTextStyle and marks the lock-screen notification private.
Tapping a notice deep-links into that host's real conversation in the shared Web UI.

The 6v Coordinator watches both independent Codex App Servers over its
existing private transports, deduplicates native turn IDs, and writes up to
300 recent completion events to its private ignored state directory.
New phones start at the current event cursor. Reconnects replay missed events;
larger backlogs are summarized. Each stored event now contains at most 360
characters of *final assistant reply preview* (plus its title, host and IDs);
it never stores full replies, previous turns, reasoning or tool output.
Content in notification previews can still be sensitive to anyone who can
read unlocked notification shade or access the coordinator's private state.
An Android-only toggle in shared Settings can
disable the foreground service. Android 13+ requests notification permission.

The monitoring service is best-effort: Android/FlClash battery restrictions,
force stop, lack of Tailnet connectivity and Coordinator downtime can delay
or prevent real-time alerts. It does not bypass Android's background limits.
Reboot recovery requires opening the app; the service is not started by a
BOOT_COMPLETED receiver. Verify actual notification delivery on a physical
Android device after installing a release APK; source-level checks do not
prove device-specific background behavior.

## 2026-11-23 Mobile sidebar pull-to-refresh

The shared responsive sidebar supports a downward pull from the top of its
scrollable list on narrow/mobile screens. Crossing the threshold and releasing
refreshes both hosts' native project/thread lists, shared sidebar pins and
available quota snapshots. A visible pull/release/loading indicator gives
feedback without hijacking ordinary scrolling, horizontal swipes or long press.
The existing desktop refresh button uses the same operation. The 6v Coordinator
serves the newly built `web/dist` directly, without a backend restart.

Web tests, Web production build, repository checks and Gateway compile passed.
Android version 0.1.18 (versionCode 20) passed the stable-build preflight, but
the actual Release APK build remains pending because CCM's automatic escalation
review failed before command execution. No 0.1.18 APK has been verified or
published yet.

## 2026-11-23 `@` catalog performance and grouping

The shared browser/Android/desktop composer shows cached native Skills, Apps and
Plugins immediately, then refreshes each catalog independently without forcing
remote reloads. Requests for the same host/project are coalesced, and catalog
timeouts leave the other groups usable. The cache is bounded and survives a
WebView reload when local storage is available.

The picker uses native plugin IDs to group plugin-owned Skills under their
installed plugin rather than listing every bundled Skill separately. Native
HTTPS icons are used where available, with local fallback icons, and a plugin
can be found by searching for one of its Skills. Native mention paths and
submission semantics are unchanged. ChatGPT/Codex conversation mentions are
intentionally **not** included.

## Windows desktop app (2026-11-21, first implementation)

`desktop/` now contains a standalone Windows Electron client for the same
`web/src/` React chat UI used by the browser and Android WebView. It connects
to the existing 6v private Web Coordinator, so 6v/noha continue to own their
own native Codex threads and tools; the desktop shell does not launch Codex
Desktop, create a second backend or copy user sessions. It adds desktop
menus/shortcuts, offline retry, per-PC private connection settings, native
save dialogs, Explorer file reveal and bounded remote-drive path lookup.
Closing the main window hides it in the Windows notification area. Use the tray
icon to restore the window or choose Quit to exit the client.
See [desktop/README.md](desktop/README.md) for setup and validation.

This is source implementation and a Windows packaging track. Android APK
generation remains explicitly opt-in, and 6v's live web frontend is not
restarted by a desktop application build.

## 2026-11-21 聊天跳转最新消息

统一 React 聊天界面 `web/src/` 新增悬浮向下箭头：离开消息底部约 60px
后显示，点击返回最新消息；手机窄屏显示在右下方，电脑端居中显示。
流式回复、图片加载或输入区改变高度时，只有仍在底部的用户才会自动跟随；
手动上滑阅读历史不会被新内容打断，回到底部后恢复自动跟随。
手机与网页共用这一实现，无需更改 Gateway 或重建 Android APK。

## 历史残留清理（2026-11-21）

- 已删除旧 Android React Native 聊天/账户/侧栏、原生 OAuth、旧诊断与视觉编辑器模块及其专属测试。现在 `App.tsx` 仅保留 Tailnet 内网入口、WebView 容器和系统文件保存桥接。手机 SQLite 保留已有数据库及 Tailnet coordinator/hosts，不删除用户数据。
- 移除了 152 个不再使用的 npm 包。完整仓库检查、50 项网页测试、Gateway 编译和 Android 构建环境预检通过。清理后的源码**尚未重新构建 APK**，当前已交付的 0.1.16 安装包仍有效。
- 6v 删除 14 个旧 APK（521,916,285 字节），只保留已校验的 0.1.16 APK；两台电脑清理了绝大多数过期发布暂存、测试文件、旧部署包和备份。noha 的运行服务仍保持 0.1.16。
- 两个旧 Git worktree 已从 Git 注册列表注销，**保留对应 Git 分支和提交**。其磁盘目录 `.worktrees/chatgpt-native-ui` 和 `.worktrees/pull-refresh-0.1.7` 因 Windows 长路径/权限问题未删除；管理员 CCM 自动审批连续失败，没有强行处理。
- 仍保留正在被进程占用的 6v `.tmp/adb-runtime` 和双方 `.tmp/codex-remote-desktop-test` 日志，不停止未知进程。继续保留 Gradle 增量构建缓存，以及两机私有的 `.state`、`.runtime`、`.env`、CodexHome、用户项目和会话数据。

## 2026-11-21 shared sidebar preference persistence

The active browser and Android WebView UI share the same local-only sidebar
preference implementation in `web/src/sidebarPreferences.ts`. It remembers
whether recent conversations include project threads, each host/project's
expanded state, the pinned/projects/recent section folds, and whether the
whole sidebar is open. These settings are saved immediately and restored
before rendering after reopening or refreshing. Existing browser section-fold
values are migrated; first visits retain the responsive sidebar defaults.
Preferences are private to the browser/WebView storage profile and never
overwrite canonical server projects, conversations or shared pins. This
change does not require a new Android APK or backend release; the shared
frontend is served directly from 6v's Web Coordinator.

## Android APK release delivery (2026-11-21)

The user requests **direct publication into the current ChatGPT conversation** for
every explicitly requested verified APK build, using CCM `publish` for the
versioned APK from 6v. **Never upload APK releases to Quark again.** A published
download URL may expire; this does not affect in-chat large file delivery.

**2026-11-21 release completed:** Android 0.1.16 (versionCode 18) ARM64
test-signed Release was built and verified using the fixed stable builder in
an approved non-sandboxed execution context. It contains the native JS bundle,
ARM64 libraries, the correct application identity and v2 signature matching
the previous APK. Verified artifact:
`.tmp/android-artifacts/CodexMobileUI-0.1.16-release-arm64.apk`
(38,389,780 bytes, SHA-256
`99A22455AFAC246DC3D1D583F2BE7A62E8DFF25EA9462F867981634636A6CC54`).
Delivered directly into the current ChatGPT conversation using CCM
`publish`, **not Quark**. The temporary CCM download URL expires; publish
again from the verified file if a new URL is requested. Android on-device
camera, chooser, download and UI behavior remain to be tested.

Both 6v Gateway/Web Coordinator and noha Gateway/Web Agent were updated
and restarted through their existing limited-user Windows scheduled tasks
after verifying ownership. noha's host-only deployment transferred and
verified 40 files while keeping its independent private `.state`, `.env`,
`.runtime`, `CODEX_HOME`, and Codex App Server. The previous noha program
files are retained in `.tmp/pre-unified-0.1.16-20261121`.
Both hosts passed a live WebSocket `initialize`, `project/list`,
`web/attachment/start` plus cancel, `web/projectDirectories`,
and `web/automation` list smoke test through the 6v Tailnet Web Coordinator.
These tests do not claim physical Android acceptance.

## 2026-11-21 unified React UI (deployed to both hosts; Android APK published)

The active Android entry has switched to the same responsive React frontend
as the 6v web workspace, loaded in an Android WebView. There is no separate
legacy Android chat surface or switch back to it. The Android shell now only
provides private Tailnet onboarding, navigation events and native publication
file save/share. `web/src` is the canonical chat and navigation UI for both.

The shared web UI now includes real project creation by remote directory
locator, per-host automation management via the existing scheduler, real
`AGENTS.md` / `config.toml` editing and assistant publication downloads.
Each computer retains its independent Codex App Server and private
`CODEX_HOME`. The Web Coordinator and per-host Gateways are **not yet merged**.
Ordinary document upload now uses the shared composer and each Web Agent's
per-connection, host-owned bounded file uploader (8 MiB each, four
attachments total). The text part uses Codex Desktop's exact file-reference
envelope, not a custom file-reading prompt. Photo selection uses the HTML
file chooser; Android's camera action uses the WebView capture input.
Native-specific device affordances and full physical Android acceptance
testing remain. The 0.1.16 APK was published to this conversation and both
hosts' Gateway/Web services are now running the newly compiled code.

## 手机内网推荐配置（FlClash + 内置 Tailscale）

手机使用 FlClash/Mihomo 内置 `Tailscale` 出站时，建议通过订阅的 JavaScript
脚本覆写，**保留全部原始 `fake-ip-filter` 规则并追加 Tailscale 域名**，
而不是在全局 DNS 覆写里重建过滤列表。完整可复制的脚本、路由规则示例、
`4190` 网页入口与 `48889` 手机版入口的区别及故障案例见
[手机 FlClash 内置 Tailscale 推荐配置](docs/mobile-flclash-tailscale.md)。

## 2026-11-20 mobile Tailnet cutover (Gateway deployed, Android APK not built)

- Mobile uses one coordinator address, `http://100.76.74.124:48889`,
  to discover 6v and noha. The private coordinator forwards machine-specific
  WebSockets to the appropriate independent App Server.
- Both Gateways are deployed and listen only on localhost and their own
  Tailscale interface on port 48889. Mobile traffic requires Tailnet membership,
  not Gateway OAuth, while native Codex login remains host-specific.
- Both old 48888 listeners and the dedicated 8443 Funnel mappings were removed.
  Other Tailscale routes (including the private Web link and unrelated services)
  were preserved. The coordinator successfully completed native `initialize`
  and read-only `thread/list` against both machines.
- This is **not physical Android acceptance**; build and deliver a new APK
  only when explicitly requested.

## 2026-11-20 compact native tool timeline (source only)

- Android and Web show native commands, MCP calls, file changes and other tool
  activity as single-line, borderless entries, with an optional expanded detail.
  The visible command label is the command itself, not "Execute command".
  Android no longer adds a summary card for adjacent command groups; native item
  identities and chronological order remain unchanged.
- Native `imageView` items can expand into image previews and use the existing
  chat-image full-screen viewer. Both relays authorize the request against the
  actual `thread/read` item ID before reading any host file; clients never
  submit image paths. Missing or invalid image content stays unavailable.
- MCP tool rows use native app/plugin identifiers to resolve logos. Android
  caches catalog entries by host in SQLite and downloaded icons in private
  local storage, displaying cached metadata while refreshing silently.
  Unmatched or unavailable logos use a generic tool icon.
- These are source changes only. The Web site and Android package were not
  built or deployed as part of this work.

## 2026-11-20 context window indicator (source only)

- Android and Web read native `thread/tokenUsage/updated` notifications and use
  `tokenUsage.last.totalTokens / tokenUsage.modelContextWindow` for the context
  ring next to Send; they never use lifetime `tokenUsage.total` as occupancy.
- Tapping the ring shows native used/window tokens and used/remaining percentage.
  Context state belongs to a thread (and host in Web). On model change the old
  capacity stays hidden until the next native turn starts; old-turn notifications
  cannot repopulate it. Native resume can restore historical usage when provided.
- Empty or unavailable native usage stays unknown. This was source-only work:
  no Web build, Android APK build, service restart, or deployment was performed.

## 2026-11-17 non-blocking connection errors (Android 0.1.13)

- Connection failures and unconfirmed user actions no longer open blocking system
  alert dialogs in chat, project/thread operations, file transfer, approvals, or
  automation management. An inline, dismissible notice beneath the header shows
  actionable errors; it also expires after eight seconds.
- Background reconnect failures remain silent. Ambiguous message submissions
  retain their existing in-chat reconciliation state rather than being retried.
  Automation errors remain visible in the task screen until the next action.
- Explicit safety confirmations for deletion, unsaved edits, and elevated
  permissions are unchanged. Web already uses non-modal status notices.

## 2026-11-17 Goal submission alignment (source only)

- The Goal editor's Done action now uses the regular send pending indicator for both
  new and existing conversations. It attempts a connection on demand instead of
  immediately rejecting an offline host.
- Goal-only submissions use native `thread/goal/set` and wait for its acknowledgment;
  they do not create an empty `turn/start`, consume the unsent composer draft or
  attachments, or mark a new thread as running. Failed or unconfirmed submissions
  keep the editable goal text for an explicit retry.
- No APK was built or deployed as part of this source change.

## 2026-11-16 cold-start stabilization (Android 0.1.11)

- Previously authorized hosts no longer briefly show OAuth login while Android
  checks SecureStore. The first chat frame waits for the selected thread's
  local SQLite cache and host preferences, not for network synchronization.
- Android's native launch window and React bootstrap are black. Existing
  threads never show a new-chat greeting while their messages are still loading.
- Reopening the app favors the last selected host and its last real thread;
  the server remains authoritative and cached data is reconciled in the background.
- Empty server history is confirmed before creating a local new-chat draft.
  With no local records and an unavailable server, the app displays a retry
  state instead of inventing a fresh conversation. Physical device acceptance
  still needs confirmation after the APK is installed.

## 2026-11-16 assistant local file links (source only)

- Codex continues producing ordinary native Markdown Windows file links;
  Android now renders the original label as a clickable private download rather
  than exposing the Markdown path or appending a duplicate file card.
- Gateway identifies links only in native assistant messages and accepts any
  regular local-drive file, not only project cwd or selected extensions. Plain
  absolute paths in prose are not published. A phone can only download a
  native-verified opaque publication ID over the authenticated WSS connection.
- Files up to 12 MiB retain immutable private snapshots with visible progress;
  larger files retain the existing Quark transfer/status behavior. Source tests
  and Gateway compilation pass; Android APK is not built or deployed here.

## 2026-11-16 Native custom permissions (0.1.10)

- Existing-thread **Custom** selection now resolves the effective computer
  permission configuration *inside the running Codex App Server*. The Gateway
  starts a no-turn ephemeral native thread with the existing thread's native
  cwd and **no permission overrides**; native `thread/start` returns the fully
  resolved `activePermissionProfile`, `sandbox`, `approvalPolicy` and
  `approvalsReviewer`. Those native values are forwarded using
  `thread/settings/update` and checked against `thread/resume`.
- Removed the independent `gateway/permissionConfig.ts` mapping of
  `config.toml` to guessed built-in profiles. Native named profiles use their
  exact ID; legacy policies use the native sandbox object unchanged.
  Mobile clients cannot submit arbitrary sandbox or policy objects.
- A live 6v native probe resolved the current default to `:read-only` with
  `readOnly` sandbox and no network access; the deleted guesser incorrectly
  selected `:workspace`. Actual effective permissions remain server-owned.
- APK version was advanced to 0.1.10 / versionCode 12 so it cannot overwrite
  the already-built 0.1.9 Release. No change to package ID or OAuth scheme.

## 2026-11-16 OAuth refresh recovery and per-host tokens

- Android now stores OAuth credentials under separate SecureStore keys per
  computer. Existing single-blob credentials migrate automatically, without
  requiring another login or copying the other computer's token.
- Gateway refresh requests with a 256-bit request ID are recoverable for up
  to 30 minutes: repeated requests return the **same** new token pair, even
  after Gateway restart. The old refresh token only recovers that same
  transaction; new credentials must be saved by Android before it sends the
  acknowledgement that invalidates the old refresh token.
- An acknowledgement lost in transit is retried from Android's persisted
  pending state. Legacy APKs without a request ID retain the previous
  one-shot refresh behavior. New APKs can also work with an older Gateway
  until its host bundle is deployed.
- This OAuth refresh is independent of sidebar pull-to-refresh, which only
  synchronizes native conversation and project data.

## 2026-11-16 权限切换与原生审批链路（源码）

- 已有空闲对话可以直接选择默认、自动审查、只读、完整访问或自定义权限。
  原生 `thread/settings/update` 更新命名权限并经 `thread/resume` 核验结果；
  切换失败不修改选中状态。自定义不再错误使用 `permissions: null`
  （原生接口中这表示不更改当前权限）：Gateway 根据该线程电脑/工作目录
  的有效 `config/read`、`permissionProfile/list`，受限地应用当前
  `config.toml` 对应的权限配置。无法完整还原的特殊沙盒配置直接报错，
  不会冒充已切换成功。此操作应用选择时的有效配置，日后编辑配置文件需重新选择。
- 自定义选项的本地标签与服务器确认的实际权限分开保存，只有确认的
  Profile/Reviewer 与该标签匹配时才显示原选项。不会仅凭界面标签授予权限。
- 新增命令、文件修改、额外文件/网络权限的原生手动审批卡片；
  只回应当前认证 WebSocket 的真实服务器请求。网关校验请求 ID
  及服务器允许的决定，一次性转发；额外权限的实际授权内容由
  Gateway 根据服务器原始请求生成，手机无法扩大范围。超时/断线、
  原生撤销或轮次完成的旧审批不能重放。
- 已更新 TypeScript、RPC 边界与行为测试；**未构建 APK、未部署/重启网关或 App Server**。
  需要后续按明确构建/部署指令安装新版并做 Android 实机验收。

## 2026-11-16 Android connection and rename fixes (source only)

- Choosing **Reconnect** on a saved computer immediately starts a fresh OAuth
  PKCE browser authorization with its stored HTTPS origin; it does not ask for
  the host address again. The normal computer-selection action still just
  switches computers. Cancelled or failed authorization retains the saved host,
  credentials and cached conversations; successful authorization replaces the
  OAuth tokens and returns to chat.
- Renaming a computer uses a centered modal instead of an inline block at the
  bottom of Settings. Empty names cannot be submitted, background/back cancels,
  and a failed save leaves the dialog open for retry.
- No APK was built and no Gateway or App Server was redeployed for this change.

## 2026-11-15 Android 0.1.9 source fixes

- Fork navigation preserves the server-confirmed new thread until it appears in
  the native conversation list. Intermediate list refreshes cannot turn the
  selected fork into a blank new-chat screen.
- Activity forwarding now retains native-ID command output arriving before a
  command-start notification, and recovers sparse native tool histories from
  previously received native activity when a thread is refreshed. Native final
  command output wins over streamed fragments; missing data is never invented.
- Command groups are initially expanded for the Desktop STEPS_COMMANDS mode.
  The Android chat no longer displays a connection-interruption cache banner.
- A 0.1.9 APK is required for on-device verification; a successful build alone
  does not prove the fixes on a physical phone.

## 2026-11-14 计划、流式公式与文件交付（源码已落地，未构建或部署）

### 2026-11-15 夸克大文件自动交付（源码已落地，未构建 APK／部署）

- 遵循 CCM 的分流阈值：助手明确交付的普通文件在 **12 MiB 及以下**继续使用 Gateway 私有、不可变快照供手机预览/下载；**超过 12 MiB** 的文件不制作内容快照，直接在对应 Windows 主机上调用已经登录的夸克桌面客户端上传到默认的「夸克上传文件」目录。
- 已将 CCM 的 WCM-derived `cloud_transfer.py` 独立移植进 `gateway/quark-transfer/`，并通过 `gateway/quarkUpload.ts` 由正常用户权限的 Gateway 启动。使用夸克本地 Desktop API、WSG 当前账号映射和上传任务数据库，只有真正完成并满足 100% / 大小一致时才标记上传成功。无需 CCM 常驻、无需夸克分享链接，也不会向 App 返回夸克登录凭证。
- Gateway 仅存储大文件的来源 ID、文件名、原始路径、大小及上传状态，不保存大文件内容。手机显示「正在上传到夸克」「已上传到夸克 · 夸克上传文件」或「无法上传到夸克」，无直接夸克下载按钮，用户自行打开夸克查看。失败状态持久保存，刷新不重复上传。
- 夸克模式要求**主机上有 Python 3、已经安装并登录夸克桌面客户端**。未安装、未登录、无法确认账号或上传失败均显示「无法上传到夸克」。`build:gateway` 会把 Python 辅助程序复制到 `dist/gateway/quark-transfer`，Host-only 包也会携带它；本次未实际向夸克上传任何测试文件。

- 原生 `plan` 项在聊天中显示短预览卡片，点击进入全屏 Markdown 阅读器，支持复制完整计划；思考摘要和普通对话统一使用 Markdown/LaTeX 渲染。
- Android Markdown 渲染将已完成的块级公式拆成稳定、独立的 RaTeX 节点，继续到来的文本不重复渲染已完成的块公式；行内公式与同段文字一起排版。尚未通过 Android 实机验证换行、滚动及大段公式性能。
- 用户附件沿用手机本地缓存优先、服务器受管路径兜底的策略。新增下载百分比和字节进度；上传进度保持不变。
- Gateway 从原生 `thread/read` 中**仅识别助手消息里的显式 Markdown 文件链接**，验证文件属于服务器已确认的会话工作目录，将可读文件保存为 `.state/published-files` 的不可变快照。无权限、删除或不支持的文件显示“无法读取文件”；普通文本提到的绝对路径不处理。
- 发布快照具有稳定的会话消息来源 ID，并通过认证 WSS 的 `workspace/publication/list` 与 `workspace/publication/read` 被手机恢复和读取；文件卡片显示原始绝对路径、预览与下载进度。**此阶段是私有发布快照，不是 CCM 的公共 HTTPS 分享链接**，也不依赖 CCM 进程。
- `fileChange` 的具体 `diff` 字段在 Gateway 转发原生事件/快照时即剔除，保留文件修改状态和路径。源代码检查与协议测试通过后才考虑按用户要求构建 APK；本次未构建、未重启 Gateway、未部署 noha。

## Android 0.1.8 输入栏调整（2026-11-13）

- 移除 App 内置语音听写、录音确认面板与未接入的实时语音对话入口，改用 Android 键盘自带的语音输入。
- 右侧蓝色按钮仅用于发送消息，输入为空且没有待发附件/新对话目标时禁用；保留发送中加载状态及附件、目标发送能力。
- 移除不再使用的 `expo-speech-recognition` 依赖、原生插件与语音专用诊断逻辑。Android 权限声明不再包含单独的录音权限。
- APK 需按明确发布请求重新构建才能在手机上生效；源码检查不等同于实体机验收。

## Web 工作台（2026-11-12）

- `web/` 是独立的 React/TypeScript/Vite 网页视觉原型，采用 ChatGPT 风格布局，包含响应式侧边栏、电脑和项目筛选、搜索、主题切换、示例执行卡片以及本地输入交互。
- 当前电脑、项目、会话均为明确标记的演示数据。**尚未连接任何 Codex App Server、Gateway 或 Tailscale**，开发预览仅监听本机 `127.0.0.1:4173`。
- 详细用法与后续接入边界见 `web/README.md`。已有 Android、Gateway、App Server、OAuth 和 Funnel 配置均未修改。

### 2026-11-13 message/attachment fixes (source only; APK not built)

- Canonical `userMessage` text no longer receives a trailing newline from an adjacent native `localImage` part. The original server turn ID also reconciles optimistic bubbles. Successful manual `thread/read` clears failed or accepted local bubbles not present in native history; it does not replay sends.
- Native image content and uploaded document references are presented as photo thumbnails or file cards rather than generated filenames/host paths. Photos can be viewed in-app; other files use the system preview or sharing chooser.
- The authenticated Gateway can read only bounded chunks of host-generated files inside `.state/mobile-uploads`; arbitrary client paths, symlinks and oversized files are rejected. Upload progress reflects the Gateway's confirmed byte count and waits for the final completion confirmation.
- Source typing and automated tests do not establish physical Android preview behavior. The new Gateway method requires deployment of compiled host code, and the Android interface requires a separately requested APK build.

Personal Android front end for a **dedicated Codex App Server** running on a Windows host. The Android app uses native Codex thread/turn/project RPCs through a narrowly allowlisted OAuth PKCE Gateway; SQLite holds local caches and unsent drafts.

Gateway attachment uploads are kept in the checkout's ignored `.state/mobile-uploads/` directory, not in the App Server's separate `%LOCALAPPDATA%` Codex home. Uploads remain host-generated, extension/size constrained and private to the local Gateway; filesystem failures report a storage error rather than mislabeling them as an invalid file format. On 6v, the Gateway now starts through an independent Windows user scheduled task, not as a CCM-sandboxed child process: its running process was verified with `TokenIsRestricted=0` and a healthy loopback listener. On a new host first register the task using `scripts/install-gateway-task.ps1` from a normal Windows PowerShell session (or CCM with approved escalation); `Start-CodexMobile.cmd` then starts it on demand, and a per-user logon trigger starts it after Windows sign-in.

**noha deployment (2026-11-13):** noha now has one Host-only installation directly at `C:\Users\noha\Documents\ChatGPT\CodexMobileUI`. The redundant `host-runtime/` was retired, and Android/Web source, development dependencies and extra runtime were removed. Its locally retained `.runtime/mobile` files matched the old copy, and its active private `.env` and OAuth state were moved into the root without changing them. The root App Server and Gateway are healthy on 45891/48888; both run with normal Windows user tokens (`TokenIsRestricted=0`), and the Gateway starts from an interactive Limited Windows scheduled task. The noha source tree is no longer a Git checkout; 6v remains the only full development source. This is local host verification, not public Funnel or physical-phone end-to-end acceptance.

## Current status (2026-11-13; Android 0.1.7 source / 0.1.6 verified release)

- **0.1.7 unified multi-computer sidebar (source):** Android now groups the real projects of every configured host under its computer name, while the recent/archived conversation list merges the hosts and labels each row with its owner. A computer filter narrows both lists without changing the active chat. The sidebar remembers folded computers/projects. A separate per-host read-only index loads cached lists first, then uses each host's existing OAuth Gateway for live metadata updates, retaining cached contents when unreachable. Selecting a foreign conversation/new-project chat carries the host ID through the switch and waits for the target session rather than reusing the old host's thread ID. Only the active `useCodexSession` can perform message/turn operations. Source tests pass; physical Android multi-host and offline acceptance remain outstanding.

- **0.1.7 composer plus menu (source):** Five entries are available: **目标、拍照、上传照片、上传文件、计划模式**. Goal is a real persistent, per-thread App Server objective (`thread/goal/get`, `thread/goal/set`, `thread/goal/clear`), not text prefixed to the next message. Its standalone composer pill opens a detail popover with the native status and **编辑 / 继续 / 清除**; Continue sends `status: active` only when the goal is paused, blocked or usage-limited. New unsent chats retain a local pending goal until the first send creates a real thread. Camera/gallery and document pickers send files over authenticated, chunked Gateway upload to private managed host storage (maximum 8 MiB per attachment, maximum four attachments per message). Plan mode requests native `collaborationMode` with the actual model/effort. 6v's private App Server `thread/goal/get` was verified read-only; physical Android acceptance and goal lifecycle mutation have not been tested on a device.

- **0.1.7 sidebar pull-to-refresh:** The native sidebar `ScrollView` now exposes Android/iOS `RefreshControl`, using a dark circular activity indicator below the fixed header. A completed pull calls the existing authenticated `session.refresh()` to reload native threads, archived threads, active messages and projects; offline pull requests reconnection instead of pretending to fetch data. The gesture is guarded against duplicate in-flight refreshes. On-device swipe and indicator placement still require physical verification.

- The Windows host source now implements an independently managed App Server and a private `CODEX_HOME`. It draws executables from the installed Codex Desktop runtime but **does not launch the Desktop app or share its live process**.
- Default private data home: `%LOCALAPPDATA%\CodexMobileUI\CodexHome`. The everyday Desktop profile `%USERPROFILE%\.codex` is untouched. No existing sessions, projects, configuration or model credentials are copied.
- Direct native backend: `ws://127.0.0.1:45891`, Gateway: `127.0.0.1:48888`, owner-authorized HTTPS Funnel: port `8443` -> Gateway. Backend is loopback-only.
- On **6v**, the private App Server is running from a separately copied Codex runtime with its own logged-in profile; native account/read returns **account_present=true**. The independently owned Gateway is healthy at 48888, forwarding only to private App Server 45891. Real public HTTPS Funnel 8443 passed OAuth wrong-secret retry, PKCE token exchange, authenticated WSS, thread/list and thread/read. One real model turn was completed and its user/assistant messages were read back from the private profile and again through the authenticated public Funnel. This proves host-side inference and public readback, **not a physical Android UI test**.
- The **6v Android 0.1.5 ARM64 Release test APK** was successfully built on 2026-11-12 after approving the fixed Android build command via CCM. Gradle completed **605 tasks (60 executed, 545 up-to-date)** in 20m 30s, including native CMake/Ninja, Metro bundle and R8 optimization. The checked artifact is `CodexMobileUI-0.1.5-release-arm64.apk` (versionCode 7, 30,016,591 bytes, SHA-256 `324B6CF43A4A9791E3C2BFB509514A218E5CE28303EC565770731FB901F84896`). Identity `dev.codexmobileui.app`, embedded JS, 20 ARM64 libraries and v2 test signature passed independent verification. CCM uploaded it to **夸克上传文件** with **FINISH / 100%** and matching size. Core 38, host 22 and build 5 tests passed, as did TypeScript checks and Gateway compilation.
- **6v Android 0.1.6 ARM64 Release (versionCode 8) built and delivered to 夸克上传文件 on 2026-11-13:** `CodexMobileUI-0.1.6-release-arm64.apk` (31,675,022 bytes, SHA-256 `AAE25277CA7981279E025602C0FEE4047584A074B53B31929101FEA8E99BC2DE`). Gradle `BUILD SUCCESSFUL` (716 tasks, 173 executed); verified package `dev.codexmobileui.app`, 3,276,956-byte offline JavaScript bundle, 21 ARM64 libraries, no other ABI and APK v2 signature. The signing certificate matches 0.1.5, and the `codexmobileui` OAuth callback is unchanged. CCM Quark reported `FINISH / 100%` and matching file size. The independently owned Gateway was recompiled/restarted and returned healthy on 48888; public HTTPS 8443 OAuth PKCE, authenticated WSS thread/list and thread/read passed again after the restart. This does **not** replace physical Android acceptance.
- **0.1.6 visual integration:** The full visual-branch Android layout, animations, sidebar, project/chat menus, visual tokens, SVG icons, app icon, speech transcription UI, account page and composer are now the single UI. `App.tsx` uses authenticated `useCodexSession` and real Codex IDs/messages/projects; no simulated reply generator remains. The visual-branch component styles, icon shapes, images and tokens were independently compared with the integrated source. Native `model/list` confirmed eight models and genuine effort options; one disposable native test project was successfully created, renamed and deleted without touching existing projects. The mainline native backend and private profile remain isolated from Desktop.
- **noha is paused by owner request.** Its Gateway, native backend and private login were not modified in this round. Noha's private backend cutover still requires its own controlled setup and validation.
- **Remaining acceptance:** install/use the new APK on a physical Android phone, exercise login, first-send, streaming, projects, title generation, filesystem permissions, offline recovery and concurrent Desktop behavior. No Codex Desktop, AOI or Funnel configuration was modified by this build.

## Architecture

```text
Android client (HTTPS/WSS + OAuth)
          |
    Tailscale Funnel :8443
          |
   MobileUI Gateway 127.0.0.1:48888
          |
  native Codex App Server 127.0.0.1:45891
          | CODEX_HOME=%LOCALAPPDATA%\CodexMobileUI\CodexHome
          | codex.exe copied from a verified Desktop installation
          |
    MobileUI-only projects and session history
```

The Desktop app and its project/chat database remain independent and usable concurrently. A project working directory selected by MobileUI can still be an ordinary host directory; data-home separation alone is **not** operating-system filesystem isolation.

Gateway OAuth is independent of native Codex model login. For model requests, authenticate the private home using `Login-CodexMobile.cmd`; do not copy another profile's `auth.json`. After that, authorize Android to the Gateway using the host's existing private OAuth consent flow.

## Features implemented in source

- **2026-11-16 attachment upload cancellation:** The Android composer exposes
  a cancel action while reading or uploading an image/document. A cancelled
  task cannot enqueue further chunks or add a late attachment to the composer;
  Gateway `workspace/attachmentCancel` also removes connection-owned uploads
  whose `attachmentFinish` acknowledgement raced with cancellation. This does
  not interrupt the current Codex turn. Definite send rejections no longer
  display the contradictory "confirmation unknown" session banner.

- **2026-11-16 image/file steering (source only):** Active-turn `turn/steer` now
  submits the same bounded text, managed `localImage` parts and uploaded-file
  text references as `turn/start` (maximum four attachments). The authenticated
  Gateway checks managed image paths and the current `expectedTurnId`; it still
  rejects mode/permission overrides. Explicit local or invalid-method/parameter
  refusals restore the draft and keep attachments, while ambiguous timeouts
  remain pending for manual history reconciliation without automatic retry.
  Multiple steers sharing one native turn ID reconcile by individual message
  text/count, not by that shared turn ID. Queue mode is still text-only. This
  source change has not been built/deployed or checked on a physical Android device.

- **0.1.7 native activity forwarding (source):** `item/started`, `item/completed`, public reasoning-summary and command-output deltas now update native turn items without synthesizing reasoning. The compact Android view shows inline reasoning summaries, expandable single tool calls and collapsible groups of adjacent same-kind commands/file changes within one turn. Failure/nonzero exit codes are distinct; finalized items and history come from `thread/read`, with host-scoped SQLite activity metadata. See `docs/activity-forwarding.md`. Physical Android streaming/visual acceptance remains outstanding.
- Native `thread/list`, `thread/read`, `thread/resume`, `turn/start`, stream events and completion reconciliation; no second inference engine.
- **后续消息处理方式（设置 → 输入框）：** 可选「引导」（默认；在正在执行的回合调用原生 `turn/steer`）或「排队」（调用原生实验性 `thread/queue/add`，由 App Server 持久保存并在当前回合完成后自动按顺序提交）。设置保存在手机端、按电脑隔离。聊天页读取 `thread/queue/list` 并响应 `thread/queue/changed`，支持删除队列项和把队列项引导到当前回合；后端 RPC 仅允许明确校验的纯文本消息。送达状态以 RPC 确认为准，不等待整个模型回合结束。排队消息暂不支持附件、目标或计划模式，执行中的任务被中断后需手动恢复排队。已通过协议单测及 6v 私有 App Server 队列只读接口验证；尚未完成 Android 实机联调。
- Project listing through `project/list`, native project IDs and real thread moves via `thread/metadata/update`. A newly isolated data home starts with no project metadata until projects are created or otherwise configured.
- Creating a native project now asks for the target computer and a browsed host directory. The project name defaults to the selected folder's name and remains editable independently of the working directory. The authenticated Gateway exposes only folders beneath the host user's `Documents` and `Desktop` directories, plus optional semicolon-delimited absolute paths in `MOBILE_PROJECT_ROOTS` on that computer. Directory locators are validated server-side; the phone cannot submit an arbitrary Windows root. The native project gets the selected directory as its `roots[0].path`; existing folder contents are not modified. An inconclusive create is never retried automatically.
- Mobile SQLite project/message snapshot replacements share a serialized exclusive-write queue with a five-second busy timeout, preventing overlapping refresh/notification transactions from being mistaken for failed native project creation.
- Local-only blank chats; first real message creates its project thread or prepares a unique projectless workspace via native `fs/createDirectory`, then starts the turn. Ambiguous RPC results are not automatically retried.
- A bounded ephemeral title worker and native `thread/name/set`, manual renames, host-scoped Android conversation caches and independently serialized drafts.
- **自动命名更新（2026-11-13）：** 首条消息获 App Server 确认后即启动独立的标题任务，不再等待首轮回复完成；`thread/name/set` 确认后立即更新侧栏和 SQLite 标题缓存。短期内防止过期的 `thread/list` 响应覆盖已确认标题，命名失败有有限次自动重试与不含会话内容的诊断事件；仍需 Android 实机验证模型生成的实际耗时。
- Host-specific OAuth PKCE/WSS Gateway, restricted RPCs, sanitized request diagnostics and Android diagnostic export.
- **Android diagnostics export (source):** On Android 10+ the primary export action writes sanitized JSON directly to the system Download/ directory using a small local Expo module and MediaStore (no broad storage permission or share chooser); an explicit system-sharing action remains available. Older Android versions use the existing share flow. The journal stays private inside the app until manually exported. Physical device verification requires a new APK and has not yet been performed.
- The Android UI takes its visual dimensions and interaction patterns from `src/ui/ChatSidebar.tsx`, `ChatView.tsx`, `AccountScreen.tsx`, `ChatSetupPicker.tsx`, `ConversationMenu.tsx` and `visual-tokens.json`. Use `docs/visual-workbench.md` for live local style adjustments.
- The sidebar and conversation menu use native archive/unarchive/delete, project create/rename/delete, conversation naming and project assignment. The local-only new-chat draft becomes a native thread on first send. The model/effort controls request the real server model catalog and submit bounded options to `turn/start`. User-visible server changes wait for an acknowledged RPC rather than altering a simulated repository.
- **即时发送反馈（源码）：** 点击发送即在消息列表显示独立的本地待确认气泡、清空输入框并锁定发送按钮；仅在 App Server 确认提交后结束转圈。本地气泡在服务器真实用户消息出现时按内容及出现次数消隐，避免重复显示；发送结果不明时保留待核对状态并恢复草稿，不自动重发。首发的安全目录准备、原生会话创建、会话 ID/草稿保护以及 `turn/start` 仍必须顺序执行，但成功后的草稿缓存清理不再阻塞发送按钮；分阶段耗时仅写入不含消息内容的手机诊断事件。尚需实机验证。
- Pinned items and unread markers are host-scoped phone preferences in a separate SQLite database. Global/project rule editors now read and save the active `AGENTS.md` or `AGENTS.override.md` on the selected computer, with native project IDs resolving actual project roots. Settings also shows the independent App Server's `%LOCALAPPDATA%\CodexMobileUI\CodexHome\config.toml`, including a missing-file state and explicit save. The narrow authenticated `workspace/hostFileRead` / `workspace/hostFileWrite` operations use SHA-256 revision checks and refuse stale overwrites; no arbitrary client path is accepted. Existing SQLite rule notes are legacy-only, never a replacement for computer files. A config save may need a new Codex session or dedicated backend restart to become effective. Permissions now use native named profiles; Full Access requires an explicit warning confirmation. Custom inherits Codex config.toml when creating a conversation. The five-entry composer menu has a bounded upload implementation in source, but on-device upload and native image/file consumption remain unverified. Scheduled task execution and real-time voice calls are still unavailable.

Not yet validated on a physical device: first-send/project/move/title flows, on-phone authorization of the private host, offline recovery, file upload/download/preview, Android keyboard behavior and new launch/stop lifecycle. See `docs/roadmap.md`.

## Windows operations

- `Start-CodexMobile.cmd`: start the dedicated backend then Gateway.
- `Stop-CodexMobile.cmd`: stop only MobileUI's owned Gateway/backend.
- `Login-CodexMobile.cmd`: separate native Codex login into the private data home.
- `scripts/mobile-launcher.ps1`: explicit start/stop/status orchestration.
- `scripts/mobile-app-server.ps1`: private backend ownership, runtime selection and health. Under restricted CCM, ownership requires private kernel path + PID file birth time + verified loopback listener instead of unavailable WMI command-line inspection.
- `scripts/probe-private-backend.mjs` / `npm.cmd run probe:private`: read-only local initialize, project/thread counts and native account-presence check without displaying user records.
- `scripts/gateway-only.ps1`: authenticated Gateway lifecycle. Its private `.env` must specify `CODEX_APP_SERVER_WS=ws://127.0.0.1:45891` before a new Gateway is started.
- `scripts/build-android-stable.ps1`: fixed Android build entry with version/signature/bundle checks. It writes Gradle cache and temporary files only under this checkout's ignored `.tmp/gradle-user` and `.tmp/build-temp`, reads the installed Gradle distribution without locking its global cache, and keeps the separate short-path native build checkout for incremental CMake/Gradle outputs.

For step-by-step Windows operations and safety boundaries, read `docs/mobile-host.md`. For network and OAuth routing, read `docs/funnel-deployment.md`. For design and scope, read `docs/architecture.md` and `docs/roadmap.md`.

## Development and security

6v is the source/build host and unified Web Coordinator. noha is a host-only deployment and Web Agent. Each keeps separate private `.env`, `.state`, `.runtime`, Codex data homes, logs, keys and runtime caches. Never commit host URLs, access tokens, login states, key material or chat history.

Shared sidebar pins are stored only on 6v in `.state/sidebar-pins.json` and require the private `.state/sidebar-pins-primary` marker. The Android app reads/writes them over the existing authenticated 6v Gateway (`sidebar/pins/list`, `sidebar/pins/set`) regardless of the currently selected computer; Web uses same-origin `/api/sidebar-pins` on the 6v Coordinator. Both clients filter the unified list by their unchanged computer selection; each caches reads locally and remembers section collapse locally. 6v must be online to change pins. The private marker and pin state are never synchronized to noha.

Run `npm.cmd run check` and `npm.cmd run build:gateway` in the checkout, and validate the real process, model auth, OAuth and device separately. Expo Release packaging must embed JS and be independently verified before uploading. There is no configured Git remote by default; do not create one without authorization.

The owner's original Desktop environment is needed for work during development. Never terminate or modify it as a MobileUI setup or troubleshooting shortcut.
# 双向电脑文件路径映射（源码已实现，尚未生产部署）

6v 和 noha 各共享整个 C 盘，分别为 `\\\\100.76.74.124\\6v1f\\` 和
`\\\\100.96.30.32\\noha\\`。在共享设置里为每台电脑维护 IP + 共享名，
配置由 6v Web Coordinator 私有保存；Electron 的本机身份由桌面壳提供。

用户输入的 Windows 绝对路径由目标主机逐台检查本机 C 盘和另一电脑的 SMB 路径。
唯一可访问匹配才改写成目标 Codex 可读的本地/UNC 路径；两台同路径都存在时
阻止发送并提示使用明确 UNC 地址，不猜测。同一消息中多个路径也逐个解析。
桌面壳选取的普通文件如能取得真实本机路径且目标可读，则直接作为 Codex Desktop
原生文件引用发送，不复制上传；否则仍走既有附件上传。普通浏览器/手机未取得
可信系统路径时继续上传。

助手消息只转换显式可点击的 Markdown 文件引用和原生图片文件引用的**展示和文件操作**
路径；普通文字/代码不转换。实际下载沿用拥有该会话的 Gateway 发布快照。
原生 Codex 历史保留真正发送的可读路径；6v 额外存储按 thread/turn 归属的路径替换
元数据，让聊天界面在刷新后还原用户输入（不修改模型的原生上下文）。
未执行实际 SMB 账户下的模型文件读取验收，未构建 Android、未重启服务、未部署 noha。
