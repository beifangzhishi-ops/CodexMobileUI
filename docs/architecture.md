# CodexMobileUI 架构（2026-11-21 当前运行状态）

## Browser-local machine detection (2026-11-23)

The shared web UI must **not** use the Coordinator host or selected thread host
as the identity of the computer displaying a file link. Ordinary browsers
identify 6v/noha by requesting `/api/local-machine` on their own loopback
`127.0.0.1:4190` (6v Coordinator) and `127.0.0.1:4191` (noha Agent).
Each listener returns only its own identity, only to the configured Coordinator
Origin and only over loopback. The web CSP allows precisely those two local
HTTP endpoints; both support Chromium private-network preflights. If exactly
one response matches, the browser uses that computer for local-vs-UNC display
path conversion. Otherwise the browser retains a manual choice, if any, or
leaves paths unchanged; it must never silently default to 6v. Android does not need a Windows
identity; unrecognized devices do not guess one.

This is deployed with the existing web static build and both loopback Web
Bridge processes. noha's host-only bundle must copy `localIdentity.mjs` as
`scripts/localIdentity.mjs` beside `scripts/web-bridge.mjs`. No APK
rebuild is required for this shared-web-only change. Verified in actual
headless Edge browsers on both 6v and noha after the 2026-11-23 deployment.

## Windows client delivery (retired 2026-11-27)

The standalone Electron/EXE client is retired. Windows uses the browser; Android uses the shared WebView. The Windows host services and official Codex runtime remain supported.

## 单一 UI

`web/src/` 的 React 应用是 **唯一** 聊天界面。Web 浏览器直接加载 6v 的 Web Coordinator；Android `App.tsx` 是极薄的 Expo/WebView 容器，只做内网入口发现、返回键和系统文件保存/分享。旧的 React Native 聊天页、账户页、侧栏、视觉编辑器、手机原生 OAuth 与独立会话状态逻辑均已删除。移动断点使用 `web/src/desktop.css`。

Android `src/storage/database.ts` 仍使用原 SQLite 文件 `codexmobileui.db`，只读取/保存 `mobile_network` 的 coordinator 与 `hosts` 机器表。升级时不主动删除旧设备上的其他表或已有数据。模型和会话状态来自目标电脑 Codex App Server，不在手机中复制一份真相。

## 主机和网络

```text
浏览器或 Android WebView
    |
    | HTTPS / WSS 4190  （仅 Tailnet）
    v
6v Web Coordinator 127.0.0.1:4190
    |                                  |
    | 本机 6v                          | noha 私有 peer 连接/令牌
    v                                  v
6v Codex App Server 127.0.0.1:45891   noha Web Agent 127.0.0.1:4191
                                            |
                                            v
                                      noha Codex App Server 127.0.0.1:45891
```

6v、noha 各自拥有独立的 Codex App Server、Gateway（48889，loopback + 自己的 Tailscale IPv4）、`.state`、`.runtime/mobile`、`%LOCALAPPDATA%\CodexMobileUI\CodexHome`、登录凭据、项目和任务调度器数据库。手机保存私有 Tailnet HTTPS 网页入口。原有 6v Gateway 的内网端口 48889 继续提供机器发现。旧的 48888 和公网 8443 Funnel 移动入口已经废弃。

MobileUI 登录启动在源码中拆成两个各主机独立的交互用户、Limited 运行级别
Windows 计划任务。`CodexMobileUI Gateway` 仅保留已验证的
`gateway-only.ps1 -Action task-run` 按需入口且没有触发器；
`CodexMobileUI Startup` 是唯一用户登录触发器，先启动并核验隔离 App Server，
再按 `gateway/main.ts` 相同的 manifest/接口选择等待恰好一个本机 Tailscale
IPv4，最后启动并核验 Gateway。启动任务只允许 Task Scheduler 的一分钟间隔、
最多三次重试，没有周期触发器或 watchdog。安装器会先验证两个任务名，再在
迁移有效旧 Gateway 登录触发器前注册新 orchestrator。

该双任务实现尚未在 6v 或 noha 注册、运行或验收；截至本次文档更新，两边仍是
此前部署状态。Web Agent、Coordinator、Desktop 和其他服务不由这组任务管理。
6v 项目是完整开发源码；noha 仅有 Host-only 运行包。仅发布编译后的 Gateway、
同版本 Web Agent 及配套模块，绝不覆盖对方私有配置、凭据、Codex Home 或运行时。

## 权限与数据边界

Web Coordinator 只接受配置的 Tailnet HTTPS 主机与端口 和同源 WebSocket Origin，不设公开的浏览器身份系统，接入设备由 Tailnet 和 ACL 控制。浏览器与 Android 发起的 RPC 均经 Web Bridge 参数白名单和目标主机 App Server 校验。禁止让客户端任意指定 Windows 文件路径、源码目录、sandbox 对象或审批结果。项目目录使用主机颁发的 locator；修改 `AGENTS.md` 和 `config.toml` 使用专用范围内的读/写 RPC 和文件版本冲突检查。Codex 的项目、会话、工具执行、模型、权限和剩余额度以所属电脑的真实服务端结果为准。

3% 额度保护默认关闭，设置只由 6v 持久化，并通过现有带凭据的私网 peer 镜像到 noha。每台电脑的 Gateway 有独立原生监控连接，不依赖网页或 UI；任一有效原生额度窗口的原始剩余比例不高于 3% 时，本机立即阻止新工作并中断已确认的精确 thread/turn。noha 设置镜像过期或尚未确认时按待同步处理，不接收新的模型工作。原生协议没有暂停队列的 RPC，因此保护不会删除或重建队列，已中断的队列项仍由用户手动恢复。

When the shared quota guard is triggered, each Gateway also follows native sub-agent activity links recursively, including descendants of already-terminal parent turns. It interrupts only verified active thread/turn pairs, repeats discovery while blocked, and does not report confirmed termination while a host or descendant scan remains unverified.

## 消息和文件

图片作为原生 `localImage` 消息部分上传；普通用户文件通过 `web/attachment/*` 在实际主机写入服务器管理目录，以 Codex Desktop 原生文件引用格式发送，绝不添加 MobileUI 自造的读文件提示词。图片和普通文件合计最多 4 个，普通文件单个 8 MiB。上传分块并提供进度及取消，上传标识仅归当前连接拥有。

助手显式 Markdown 文件链接保持原文并在原位置只显示 Markdown 标签。
打开会话或调用 `workspace/publication/list` 不会创建快照；点击链接时，
Web Bridge 才要求所属 Gateway 重新读取原生线程，并验证具体
`agentMessage` item ID 与有界 link index，随后只发布该单文件。Gateway
快照保留 72 小时，单文件上限 256 MiB、总缓存上限 512 MiB，使用 64 KiB
分块；新发布不再启动夸克上传。可读取的旧夸克记录在再次点击时重新生成
私有快照。任何普通正文绝对路径都不会自动变成任意主机文件读取。

Coordinator 的 `/api/publication` 仅接受主机、opaque snapshot ID 和
download/preview 模式，提供 HEAD、单段 Range、无存储缓存和 MIME 校验。
文本预览最多 256 KiB；PDF 由打包的 PDF.js 渲染；音视频按范围读取。
HTML/SVG 预览同时由 sandboxed iframe 和外层
`sandbox; default-src 'none'` CSP 隔离，脚本、表单和远程资源不可执行。
Android 只消费服务端 ID，由 `src/core/nativePublicationDownload.ts` 保存到
自己的目录并调用系统保存/分享；浏览器复制私有 URL。两端都不取得任意主机文件读取能力。

## 发布与验证

2026-11-21 的版本为 `0.1.16`、Android versionCode `18`。6v 和 noha 的 Gateway/Web 服务已部署；通过两个主机真实 WebSocket 的 `initialize`、`project/list`、`web/attachment/start` / cancel、`web/projectDirectories`、`web/automation` 列表验收。

Android ARM64 安装包通过稳定构建脚本、版本与包 ID、内置 JS、ARM64、v2 测试签名和 SHA-256 检查，并由 CCM `publish` 直接交付当前 ChatGPT 对话，**不再上传夸克**。当前 APK 的 SHA-256 为 `99A22455AFAC246DC3D1D583F2BE7A62E8DFF25EA9462F867981634636A6CC54`。

电脑 WebSocket 验收不能代替实体机验收。Android 拍照、文件选择、下载/分享、键盘行为及触摸交互仍应在真实设备上测试。只有用户明确要求时才构建新的 APK。
# 双向 SMB 路径映射（2026-11-21，待部署验收）

- 共享设置保存在 6v `.state/file-path-hosts.json`（仅 IP / 共享名），
  默认 `6v=100.76.74.124/6v1f`、`noha=100.96.30.32/noha`，
  共享名对应各自 `C:\` 根。电脑桌面壳还保存自己的 localHost 身份。
- 网页/Android 的用户输入只有在含绝对路径时才调用目标主机的
  `web/pathResolve`。请求经过现有 WebSocket 白名单；目标主机通过 Node
  受限的 stat/access 验证本机和远程 SMB 候选，唯一匹配才变换。
  相同绝对路径同时存在于两台主机则禁止自动选择，用户需提供明确 UNC。
- 浏览器和 Android 文件选择使用受限上传流程；用户输入的绝对路径仍通过跨主机路径解析。
- 助手回复只在原有显式文件链接显示上投影本机/UNC 路径；普通文本、代码及
  Codex 原生输出均保持不变。手机沿用原始链接拥有者的文件下载服务。
- 6v `.state/file-path-overlays.json` 仅存 user turn 与路径替换对，浏览器
  `thread/read` 后用它还原用户界面的原始输入，不把原始路径覆盖回模型上下文。
- 上线时必须同步两端 Web Bridge 及 noha Agent 随附的 `pathResolver.mjs`、
  `pathSettings.mjs`、`pathOverlays.mjs`，不修改现有私密配置。
  对不同运行账户的 SMB 可读性、真实模型读取文件、手机文件引用/下载分别验收。
