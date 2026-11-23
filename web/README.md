# Codex 多电脑 Web 工作台

## 2026-11-21 与 Android 统一的附件界面（双机已部署）

0.1.16 已在 6v Web Coordinator 和 noha Web Agent/Gateway 上发布。两台机器
均通过真实 WebSocket 的初始化、项目列表、附件开始及取消、目录读取、
定时任务列表测试。Android 0.1.16 ARM64 APK 已在当前 ChatGPT 对话通过
CCM publish 发布，不再上传夸克。手机实际拍照、文件选择和文件保存仍
需要实体机验收。

当前浏览器与 Android WebView 只使用 `web/src/DesktopApp.tsx` 的一套
聊天组件。添加菜单支持照片、拍照（窄屏）、普通文件；文件与图片合计
最多 4 个，单个文件最多 8 MiB。普通文件从选定主机的 Web Agent
上传，严格复用 Gateway 的 `createAttachmentUploader` 与 Codex Desktop
文件引用封包；不通过输入的 Windows 路径调用任意文件系统接口。
手机聊天仅显示附件名称和助手原始文件链接标签，桌面仍可复制绝对路径。

**noha Web Agent 同步必须原子替换配套代码**，不可只复制
`web/server/bridge.mjs`。源文件与目标文件对应关系：

- `web/server/bridge.mjs` → `scripts/web-bridge.mjs`
- `web/server/imageStore.mjs` → `scripts/imageStore.mjs`
- `web/server/assistantImageRefs.mjs` → `scripts/assistantImageRefs.mjs`
- `web/server/securityPolicy.mjs` → `scripts/securityPolicy.mjs`
- `web/server/attachmentProtocol.mjs` → `scripts/attachmentProtocol.mjs`

同时需要更新 noha host-only bundle 的编译 `dist/gateway`（尤其
`attachments.js`、`projectDirectories.js`、`nativePermission.js`
和 `webTitleService.js`），不要复制任何 `.state`、`.env`、
私有证书、登录凭据或 CodexHome。6v 的网页与 Agent 在源码目录运行，
不需复制这些相对模块。上线前分别验证 6v 和 noha 的附件上传与回读。


## 会话标题：Web 与 Android 一致

两端侧栏先显示 App Server 的 `thread.preview`（第一条用户消息预览），
当原生 `thread.name` 存在时显示正式名称。只在本地首轮刚得到确认而
`thread/list` 尚未同步时使用本地用户文本作临时预览；图片或文件引用仅以
简短安全标题显示，不把文件路径传输封包展示到侧栏。

Web 首轮得到 `turn/start` 确认后，由实际所属电脑的 Web Bridge
独立排队发起临时只读自动命名，结果通过原生 `thread/name/set` 写回。
队列存放于各主机私有的 `.state/web-title-jobs.json`，网页关闭不影响已接受任务。
手动改名优先，且自动命名在提交前再次读取服务器名称；失败保留原生预览。
Android 保留自己已有的临时线程自动命名，两个客户端均不另建正式标题数据库。

## 2026-11-17 与 Android 交互对齐

### 2026-11-23 共享长按与右键操作

- 同一套 React 上下文菜单支持侧边栏对话、项目，以及消息、文件和图片。桌面使用右键，Android WebView 对侧边栏条目、文件和图片使用 450ms 长按；移动超过 12px 或滚动即取消，不叠加普通点击。
- 对话操作包括重命名、置顶、客户端未读标记、同电脑项目归属调整、当前聊天内容查找、归档、删除、复制 ID/链接/可用工作目录、内网链接分享；项目支持新建聊天、置顶、重命名、项目规则、复制目录和删除。用户明确不需要分组、Fork、其他位置打开或新窗口打开，故不显示这些入口。
- 项目/对话列表行禁用触摸文本选择，防止长按被 WebView 截获；**消息正文仍允许系统原生长按选字**，桌面选字右键也交给系统。消息完整复制走右键菜单和现有按钮，避免抢掉原生文本选择。不可保证纯 HTTP 内网 WebView 支持复制图片，失败时明确提示。
- 「标为未读」只存当前客户端本地偏好，未写入 native App Server；会话链接只在能访问私有 Web Coordinator 的设备上有效。工作目录来自已校验的原生项目 roots；文件打开/下载继续走原有跨主机路径、已发布文件校验，不提供任意文件读取。
- 此段记录源码行为；是否能通过实际 Android 设备的长按与系统选字仍需实机验收。

- 保留网页的桌面式双机/项目布局，聊天正文改为 Markdown（GFM 表格、代码块、公式），工具和思考仍取自原生 App Server 事件，不能伪造推理结果。
- 用户消息仅显示原生消息时间；助手轮次结束（含中断/失败）后在最下方显示复制及时间。早期版本曾显示 `thread/fork` 按钮，该入口已在 2026-11-23 按用户偏好移除。发送键在正在运行且输入框为空时变为停止键；发送、停止和目标创建均等待服务器确认，保留未确认发送的可见状态。
- 已有会话权限调整通过原生 `thread/settings/update` 并由 `thread/resume` 回读后才切换勾选；自定义权限仍须电脑端配置解析，因此网页暂时不允许直接覆盖已有会话。新会话选择自定义默认继承原生配置。会话菜单对接原生重命名、归档/取消归档和删除（删除前确认）。
- **网页文件规则（2026-11-17 最新）**：普通文件仅显示绝对路径并支持复制，不支持上传、远程文件下载或自动打开。用户粘贴绝对路径原样发给 App Server。助手返回的显式 Markdown 图片链接（PNG/JPG/WebP/GIF/BMP）是唯一的本地文件预览例外：从原生助手消息核实引用后，只读传输受 8 MB 限制的真实图片数据，在聊天中显示缩略图、点击查看原图，同时保留并可复制绝对路径。其他文件链接不下载、不读取；图片粘贴和历史用户图片继续走原有 localImage 接口。Web Bridge 不开放任意文件路径读取，web/file/* 和 web/publication/* RPC 继续禁用。
- 最近聊天对齐 Android 的前 10 条及“加载更多对话”；网页通过原生完整分页列表区分真实保存的旧测试聊天与未完成的新线程，去除刷新时长期残留的假会话。窄屏布局中发送按钮和电脑选择器保证不溢出。
- 本地检查包括 `web` TypeScript、协议测试和 Vite 生产构建；这些不等于双机浏览器实时操作或权限写入的端到端验证。正式网页静态入口仍由 6v Web Coordinator 的 `web/dist` 提供，noha 保留独立 Web Agent。

## 当前入口（2026-11-23）

6v 使用私有 Tailscale Serve 在 HTTPS 4190 端口代理回环 Web Coordinator。网页和任务通知使用同源 WSS，接入继续受 Tailnet ACL、Host 和 Origin 校验约束。noha 的私有 TCP 4191、独立 App Server 和主机间令牌沿用现有配置。

在 **电脑与设置 → 浏览器任务完成通知** 启用并授予站点权限。打开标签页时支持任务完成弹窗，点击回到对应主机和会话。首次启用从当前游标开始，重连可补收离线事件。旧 Android 安装包须升级后才能填写新的私有 HTTPS 入口。

网页包含按电脑分组的真实项目和会话、历史记录读取、流式文本与工具调用/思考摘要、模型与思考强度选择、运行计时和停止、真实文字消息发送。已对齐手机端最近新增的原生功能：引导运行中的轮次（`turn/steer`）、排队和队列删除（`thread/queue/*`）、目标获取/设置/清除/继续（`thread/goal/*`）、计划模式，以及由 `permissionProfile/list` 校验的命名权限档位。完整访问权限必须明确确认，不能从网页直接提交任意 sandbox/cwd。

**双机真实发送已验收**：通过 noha 浏览器同款 WebSocket 路由访问统一 6v IP，分别在 6v 与 noha 独立测试工作区创建一条真实线程；`turn/start` 返回原生 turn ID，`thread/read` 确认两边轮次均完成且保存的助手回复含测试标记。消息失败/超时不会自动重试，须手动刷新核对。以上仅是安全的只读/只读权限测试消息，不代表其它权限、引导/队列/目标的写操作或实际审批交互均已逐一验收。

普通文件上传/预览、创建项目时选择目录、定时任务创建、真实删除与分支仍未接通。**图片粘贴上传与历史图片预览已接通**；审批框只对当前连接收到的原生实时请求提供交互，不重放离线审批；如果服务端未提供可核对的操作详情则禁用批准。上述操作不能以本地 UI 模拟充当服务器行为。Web 与手机统一从 6v `.state/sidebar-pins.json` 读取置顶项目/会话；网页经同源 `/api/sidebar-pins` 访问，手机经 6v 认证 Gateway 访问。电脑筛选沿用原有逻辑，折叠状态由各端独立保存。

## 图片粘贴与历史记录

网页聊天输入框支持直接用 Ctrl+V 粘贴剪贴板图片，或从加号菜单选择图片：PNG、JPG、WebP、GIF、BMP，单张最大 8 MB，每条最多 4 张。图片会先在输入框上方显示缩略图，发送时显示上传进度，上传完成后与文字一起写入原生 \`turn/start\` 的 \`localImage\` 项。纯图片发送也使用手机端约定的图片提示。引导正在运行的轮次及队列消息暂时只支持文本，不能带图发送。

每台主机的 Web Bridge 把图片独立保存于本机 \`.state/web-uploads\`。浏览器只通过 \`web/image/start\`、\`chunk\`、\`finish\` 与 \`read\` 等固定 RPC 访问，不能传任意文件路径；\`turn/start\` 的图片路径必须属于同一条 WebSocket 连接刚完成的受限上传。所有图片内容检查扩展名与魔数，且最多 8 MB。noha 经 6v Coordinator 的专用令牌转发，上传文件始终保存在目标电脑，而不是复制到 6v。

App Server 的 \`thread/read\` 返回历史用户消息的 \`localImage\` 路径引用，但不直接返回图片字节。历史图片通过 \`web/image/read\` 按原生 \`threadId\`、\`itemId\`、\`imageIndex\` 在主机上查找真实引用，再从受限的 \`.state/mobile-uploads\` 或 \`.state/web-uploads\` 分块返回字节；网页只显示缩略图，点击可查看原图，不向浏览器提供任意文件读取接口。旧上传文件若被清理，将提示图片不可用，不能从路径恢复已经丢失的图片。

**真实验证**：6v 的真实历史中找到 3 个 \`localImage\` 引用，选择其中一个现存 JPG 通过新接口完整读取，SHA-256 与原始文件一致。noha 经统一 IP 的 WebSocket 成功上传测试 PNG、创建原生只读线程、发送带图 \`turn/start\`、收到模型回复并在 \`thread/read\` 中确认历史图片存在，读取的图片内容也一致。测试包括拒绝不存在的图片 item ID、任意 Windows 路径和非当前连接上传的图片路径。Web 图片协议/快照共 9 项单元测试通过；浏览器实际 Ctrl+V 操作仍需在用户设备上验收。

## 服务与启动

6v：`web/server/bridge.mjs coordinator`，监听 `127.0.0.1:4190`。

noha：`scripts/web-bridge.mjs agent`，监听 `127.0.0.1:4191`。

两机使用用户级 Windows 计划任务自动启动，分别命名为 `CodexMobileUI-WebCoordinator`、`CodexMobileUI-WebAgent`。任务当前改为 `wscript.exe //B //NoLogo` 启动 `web/server/start-hidden.vbs` 或 `scripts/start-web-agent-hidden.vbs`，使用隐藏控制台的 `WScript.Shell.Run(command, 0, True)`。已经验证两个任务的新 Node 进程没有可见主窗口、端口健康且经统一 IP 的双主机项目读取正常。任务仅在对应 Windows 用户登录后启动，整机冷启动和登录后的自动恢复尚未实测。

开发网页时在 6v 项目根目录运行：

```powershell
npm.cmd --prefix web run check
npm.cmd --prefix web run test
npm.cmd --prefix web run build
```

生产静态文件由 Web Coordinator 的 `web/dist` 直接提供，不需要复制到 noha。Vite 开发预览仍只绑定 `127.0.0.1:4173`，不作为正式入口。

### 部署验收

2026-11-13 已从 noha 对 `http://100.76.74.124:4190/` 的 HTML、JS、CSS 分别验证 HTTP 200；通过该地址的 WebSocket 对 6v 和 noha 的 `initialize`、`project/list`、`thread/list`、`model/list`、`permissionProfile/list` 等验证成功；6v 还确认 `thread/read`、`thread/queue/list` 和 `thread/goal/get`，并验证非白名单文件系统 RPC 被拒绝。双机的真实独立线程创建/文本发送/模型回复/保存历史测试均通过。Web 原生协议测试共 9 项通过，TS 与生产构建通过；旧 9443/9444 Serve 已独立关闭，原有 Funnel 映射保留。后续仍需实测 Windows 冷启动、浏览器图形界面、真实审批及各写入子功能。
