# 统一 Web / Android 界面的本地调试

CodexMobileUI 只有一套聊天界面：`web/src/` 中的 React 应用。桌面浏览器直接使用它，Android 的 `App.tsx` 使用 WebView 加载 6v 内网 Web Coordinator。旧 `src/ui/`、`visual-tokens.json`、本地 Visual Editor 和 `Start-Visual-Workbench.cmd` 已退役。

## 视觉修改

- React 组件、输入框、侧栏和消息正文：编辑 `web/src/`。
- 布局、配色和移动端断点：编辑 `web/src/desktop.css`。
- 图标和 Android 启动画面：更新 `assets/`，如需重新生成图标可运行 `scripts/make-visual-icon.py`，图标变更需要下一次明确请求的 APK 构建。
- 在 6v 运行 `npm.cmd --prefix web run check`、`npm.cmd --prefix web run test` 与 `npm.cmd --prefix web run build`。生产入口为私有 Tailnet 的 `http://100.76.74.124:4190/`，不可将本地 Vite 预览公开到公网。

## 验证边界

浏览器和 Android 使用相同的数据、权限、文件引用与后端 RPC。改动共享网页可能立即影响已经安装的 Android，生产部署需要遵循双机 Web Coordinator / Agent 验证规则。浏览器断点和自动化测试不能取代真实 Android 的文件选择、拍照、下载、返回键及键盘验收。不再运行已经退役的原生 UI 视觉编辑器。