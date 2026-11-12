# 电脑端视觉工作台

此文档描述 Windows 6v 上的 **CodexMobile 视觉版** 调参工具；与正式 OAuth App 和真实 Codex 连接无关。

## 工作方式

1. 在 Android Studio 启动已有的 `Medium_Phone_API_37.0` Android x86_64 模拟器。
2. 在项目根目录双击 `Start-Visual-Workbench.cmd`，打开 Metro 及本地可视化编辑器。
3. 浏览器访问 <http://127.0.0.1:49173/>，同时在模拟器中打开已安装的 **CodexMobile 视觉版 Debug**。
4. 选择参数并拖动滑块。临时预览由本机 HTTP 服务提供给模拟器，**并不写入源码**；支持撤销未保存更改。
5. 点击“保存到源码”后，仅更新 `src/ui/visual-tokens.json`，Expo Fast Refresh 可自动加载保存值。

编辑器只有本机 127.0.0.1 地址监听，`10.0.2.2` 是 Android Emulator 映射到 Windows 回环接口的专用地址。不对局域网、Funnel 或真实手机提供服务。写入接口仅接受同源 JSON 和预先声明的样式参数，不允许任意路径、命令或网络代理。

## 可调整的内容

- 主界面顶部栏高度、新建对话写字板图标大小。
- 侧边栏宽度、最大宽度、水平滑入/滑出时长。
- 项目行、会话行、标题行、顶部和底部固定区域、新聊天按钮的高度。
- 输入框最小高度、圆角、底色、底部工具栏高度。
- 普通启动器 Logo 与 adaptive icon 中白色几何的占比：编辑器可近似预览，保存后需运行 `scripts/make-visual-icon.py` 生成 Android 原生图标，再通过下一次 Android 构建更新启动器；该部分无法由 Metro 热更新。

浏览器中的手机缩略图是辅助设计画布，**实际交互、输入法以及动画以 Android 模拟器为准**。

## 开发构建边界

- 仅 Android x86_64 Debug 开发版可以通过 Metro 提供实时 JS 样式变化；已有 ARM64 Release APK 是内嵌 JavaScript 的独立安装包，不能直接用于热预览。
- `expo-dev-client` 随开发版打包，已安装的 Storybook 依赖保留作为后续组件隔离设计工具。本工作台当前使用独立浏览器调参服务，而不是将 Storybook UI 注入正常 App。
- 新增或修改 Android 原生依赖与图标资源需要重新构建；普通 UI 样式参数不需要重新打包。
- 浏览器服务端口 49173，Metro 端口 8081。只在本机开发期间运行。调参源码应提交到视觉版 Git 分支。

当前能否在真实模拟器中成功连接 Metro，需要以 Debug APK 的安装与启动实测为准，不能仅以 HTTP 健康检查替代。
