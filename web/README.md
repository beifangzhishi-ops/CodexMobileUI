# Codex 多电脑 Web 工作台

## 当前入口（2026-11-13）

统一网页使用 **6v 的 Tailscale IPv4：`http://100.76.74.124:4190/`**。6v 和 noha 均可通过此地址访问同一份网页。浏览器不需要登录，也不要求 Tailscale Serve 身份头；实际网络访问由 Tailnet 的设备接入和 ACL 控制。能够连入这个端口的 Tailnet 设备就可以使用该工作台，因此应当只授权可信设备。

Tailscale 只转发 TCP，不使用旧的 HTTPS 域名 Serve。6v 的 `tcp://100.76.74.124:4190` 转发到 `127.0.0.1:4190` Web Coordinator；noha 的 `tcp://100.96.30.32:4191` 转发到 `127.0.0.1:4191` Web Agent。原生 App Server 在各自主机继续使用 `127.0.0.1:45891`。noha 的 Agent 仍要求主机间随机令牌，该令牌存放在两机私有的 `.state/web-peer-token`，**不会发送到浏览器**。旧的 HTTPS Serve 9443/9444 均已关闭，原有 Android 使用的 Funnel 与 Gateway 未修改。

网页仅接受指定 IP:端口的 HTTP Host，WebSocket 还要求匹配的 Origin，防止普通第三方网页直接发起跨站 WebSocket。Tailscale TCP 转发及本机 App Server 继续将对外访问限制在 Tailnet 内。HTTP 链路上的数据由 Tailscale 网络加密，但浏览器是普通 HTTP，部分仅在安全上下文可用的 Web API 需要降级处理。

网页包含按电脑分组的真实项目和会话、历史记录读取、流式文本与工具调用/思考摘要、模型与思考强度选择、运行计时和停止、真实文字消息发送。已对齐手机端最近新增的原生功能：引导运行中的轮次（`turn/steer`）、排队和队列删除（`thread/queue/*`）、目标获取/设置/清除/继续（`thread/goal/*`）、计划模式，以及由 `permissionProfile/list` 校验的命名权限档位。完整访问权限必须明确确认，不能从网页直接提交任意 sandbox/cwd。

**双机真实发送已验收**：通过 noha 浏览器同款 WebSocket 路由访问统一 6v IP，分别在 6v 与 noha 独立测试工作区创建一条真实线程；`turn/start` 返回原生 turn ID，`thread/read` 确认两边轮次均完成且保存的助手回复含测试标记。消息失败/超时不会自动重试，须手动刷新核对。以上仅是安全的只读/只读权限测试消息，不代表其它权限、引导/队列/目标的写操作或实际审批交互均已逐一验收。

网页附件上传、创建项目时选择目录、定时任务创建、真实删除与分支、图片/文件预览仍未接通。审批框只对当前连接收到的原生实时请求提供交互，不重放离线审批；如果服务端未提供可核对的操作详情则禁用批准。上述操作不能以本地 UI 模拟充当服务器行为。Web 侧置顶/筛选等显示偏好不与手机端 SQLite 偏好自动同步。

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

2026-11-13 已从 noha 对 `http://100.76.74.124:4190/` 的 HTML、JS、CSS 分别验证 HTTP 200；通过该地址的 WebSocket 对 6v 和 noha 的 `initialize`、`project/list`、`thread/list`、`model/list`、`permissionProfile/list` 等验证成功；6v 还确认 `thread/read`、`thread/queue/list` 和 `thread/goal/get`，并验证非白名单文件系统 RPC 被拒绝。双机的真实独立线程创建/文本发送/模型回复/保存历史测试均通过。Web 原生协议测试共 5 项通过，TS 与生产构建通过；旧 9443/9444 Serve 已独立关闭，原有 Funnel 映射保留。后续仍需实测 Windows 冷启动、浏览器图形界面、真实审批及各写入子功能。
