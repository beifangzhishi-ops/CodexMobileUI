# CodexMobileUI Android 视觉编辑工作台

## 当前结构

Android 的唯一正式界面由 `App.tsx` 和 `src/ui/` 内的 `ChatSidebar`、`ChatView`、`ChatSetupPicker`、`AccountScreen`、`ConversationMenu`、`ReferenceIcons` 组成。视觉参数统一保存于 `src/ui/visual-tokens.json`。它们直接接入真实 Codex 会话和 OAuth，不使用独立的模拟会话数据库。

独立的 `web/` 浏览器工作台是另一个尚未接入真实设备的前端项目；它的开发状态不代表 Android App 的连接状态。

## 本地可视化调参

1. 在 6v 的 Android Studio 启动 `Medium_Phone_API_37.0` 模拟器，安装与当前源码匹配的 x86_64 Debug 版本。
2. 运行项目根目录的 `Start-Visual-Workbench.cmd`，启动 Metro 与本地样式编辑器。
3. 在电脑浏览器打开 <http://127.0.0.1:49173/>，在模拟器打开 CodexMobileUI。
4. 调整侧边栏滑动时长、宽度、项目和会话行高、顶部及底部布局、输入框尺寸/圆角和 Logo 内部几何大小。预览仅写入本地临时状态，不改变源码；点击保存才写入 `src/ui/visual-tokens.json`，Fast Refresh 随之更新。
5. Logo 图标静态资源变更需重新运行 `scripts/make-visual-icon.py` 并重新生成 APK；Metro 无法热更新已打包的 Android 启动器图标。

编辑器仅监听 `127.0.0.1:49173`，模拟器通过 `adb reverse tcp:49173 tcp:49173` 连至本机；没有公网或 Funnel 暴露。编辑器接口限制为受检查的同源样式值，不能读写任意电脑文件，也不能转发 Gateway 凭证。

## 实际验证边界

视觉参数编辑与 TypeScript/合同测试只证明样式和源码一致；不能替代手机上的 OAuth、真实对话流、模型选择、按键和输入法测试。

Android 上的会话、项目、归档、删除、重命名、移动和模型/思考强度操作均需原生 Codex App Server 经 HTTPS/WSS Gateway 确认。置顶、未读标记和规则备注由本机 SQLite 分电脑存储；备注不会自行修改电脑的 AGENTS.md。附件上传、定时任务与实时语音对话的服务端能力尚未开放，界面会明确提示。

构建当前 Android 安装包必须使用 `scripts/build-android-stable.ps1`；不要使用 Android Studio 直接构建流程替代签名、版本号、离线 JS 与 ARM64 校验。
