# CodexMobileUI Windows 桌面端

桌面端是独立 Electron Windows 客户端，**只加载已部署的 6v Web Coordinator**，使用 `web/src/` 同一套 React 聊天 UI，不创建新的 Codex 后端或对话数据库。6v、noha 仍由各自的 App Server 管理项目、线程、模型和审批。

主窗口顶部采用 48px 单行标题栏：CodexMobile 标题、文件/编辑/视图/窗口菜单同排，保留 Windows 原生窗口控制。菜单通过受验证的原生 IPC 打开 Electron 子菜单，断线页同样展示标题栏。

主窗口按 × 或 Alt+F4 会收起到系统托盘，保留当前聊天和输入状态。单击托盘图标、选择托盘菜单的「打开窗口」或再次运行 EXE，都会恢复已有窗口。托盘菜单的「退出 CodexMobileUI」和「文件 → 退出」会结束桌面客户端。最小化仍进入任务栏。

## 开发与打包（在 6v 项目根目录）

```powershell
npm.cmd install --prefix desktop --cache .npm-cache
npm.cmd --prefix desktop run test
npm.cmd --prefix desktop run smoke
npm.cmd --prefix desktop run start
npm.cmd --prefix desktop run package:win
```

0.2.0 便携目录在忽略的
`.tmp/desktop-release/0.2.0-offline/CodexMobileUI-win32-x64/`；同版本的
便携 ZIP 位于 `.tmp/desktop-release/CodexMobileUI-0.2.0-win32-x64-portable.zip`。
这是 Windows x64 Electron 包，不是 Android APK。请先启动原有服务和
内网/Tailscale；桌面端自身不会启动、重启 Codex Desktop、Gateway 或 Web
Coordinator。

## 连接与文件

- 默认 Coordinator 使用 Tailnet 私有 HTTPS 的 4190 端口。已安装的桌面端可在「文件 → 连接设置」中填写新地址。
- 如果开着 Windows FlClash 后 HTTPS 4190 无法访问，而系统 Tailscale 已正常连接，请参考 [独立 Tailscale + FlClash DNS 设置](../docs/desktop-flclash-tailnet.md)。不要复制手机的 `type: tailscale` 出站脚本；当前桌面版实测报「不支持的代理」。
- 从文件菜单打开 **连接设置**：选择当前电脑 6v / noha，配置各自私有 IP 和可选的 C 盘共享名。这些客户端首选项仅存在当前 Windows 用户的 Electron `userData/desktop-settings.json`，**不写入 Codex Home**。
- 助手显式本地链接可尝试在 Windows 资源管理器中定位；当前机器用原始盘符路径，另一台机器先试 `\\IP\C$` / `\\IP\D$` 等管理共享，C 盘另试用户配置的 `\\IP\共享名`。仅在文件实际存在且可访问时定位。不能访问时显示错误，不假装成功、不下载文件伪装为本地路径。**不同共享根的实际映射需在真机测试，不能仅凭 IP 推定**。
- 助手显式文件链接打开共享预览页，本端操作是 **在资源管理器中定位**；
  Android 走系统保存、普通浏览器复制 opaque 私有链接。不暴露任意路径文件
  读取接口，也不自动执行本地 EXE 或脚本。
- 新建聊天 `Ctrl+N`，搜索 `Ctrl+K`，侧栏 `Ctrl+\`，重连 `Ctrl+R`，连接设置 `Ctrl+,`。文本选择与输入框使用原生右键菜单。

## 安全和验收

主窗口禁用 Node 集成，开启 contextIsolation、sandbox、webSecurity，禁止第三方页面导航。仅当前 Coordinator 顶层页面可调用定位文件的 IPC，设置窗口的 IPC 只在本地受控设置页可用。外部 HTTP(S) 链接仅在系统浏览器打开；其他 scheme 不自动交给操作系统。

本地测试和构建不能代替在 6v 和 noha 的实际 Windows 桌面窗口验收。需要核对 Tailnet 可达性、Explorer 权限/共享盘映射、剪贴板图片、下载对话框、窗口快捷键、双机对话及退出/重启。
