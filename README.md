# CodexMobile 视觉版

独立 Android 视觉测试应用。使用 Expo SDK 58、React Native 0.88 和 assistant-ui Native。
**本应用目前只运行本地交互模拟，不连接 Codex App Server，不执行真实命令、OAuth 或定时任务。**
此工作树不修改原有的 OAuth Android 应用、共享内核、Gateway 或 Funnel。

## 当前功能

- Android 包名：`dev.codexmobileui.visual`；版本：`0.3.0`（versionCode 1），与 OAuth 应用可并装。
- 黑色主界面、深灰圆角输入框，发送任意非空消息后本地统一回复：
  `请点击左上角菜单-下方头像连接电脑`。未连接电脑仍可建项目、建会话、发消息。
- Codex 桌面式侧边栏：项目默认五项、支持展开全部项目；每个项目点击展开/收起自己的对话，子会话默认显示五条、可展开全部；最近对话初始显示十条，点击“加载更多对话”每次追加十条。
- 最近对话标题右侧设置勾选“包含项目内对话”。项目与最近对话共享同一会话 ID，不复制会话内容。
- 只在运行中的会话右侧显示进度图标、已完成但未读的会话右侧显示未读点；空闲和已读无标记。项目和对话长按可弹出本地操作菜单。
- 侧栏顶部的名称/搜索及底部蓝色“聊天”按钮/头像分别是带半透明底的固定层，中部项目与对话属于同一个滚动容器。
- 头像进入电脑列表与全局规则。点击电脑可切换本地演示选中项，长按显示重命名/断开/重新连接；断开直接移除记录。无电脑时只显示“连接新的电脑”。
- “连接新的电脑”打开离线 WebView 测试网页：点击按钮显示“测试成功”，同时添加一条**明确标识为演示、并未连接真实服务**的电脑记录。
- 全局规则与项目规则使用原样纯文本编辑框，可全屏展开，不渲染 Markdown。所有演示数据使用独立的 SQLite 数据库存储，重启后保留，与正式会话缓存和认证信息完全隔离。
- 输入框模型选择弹层、权限演示弹层、系统语音听写录音/识别/确认。模型和权限仅改变本地选中状态，不访问后端或授予实际权限；蓝色实时语音按钮明确提示未接入。
- 麦克风优先使用 Android 系统 SpeechRecognizer（`expo-speech-recognition`），权限不足或系统未安装服务时提示原因。是否支持红米 K80 中文识别和离线识别仍需要真机测试。
- 已保留脱敏诊断日志入口。定时任务仅提供本地未接入空态。

## 页面与数据边界

`App.tsx` 管理路由与侧栏；`src/ui/ChatSidebar.tsx` 管理项目树与最近对话；`src/ui/DemoChat.tsx` 渲染本地聊天及输入区；`src/ui/AccountScreen.tsx` 提供电脑管理和规则编辑。

`src/demo/conversations.ts` 是唯一的本地会话/项目/状态归属模型，`src/demo/persistence.ts` 序列化到视觉版专用 SQLite 数据库。项目删除会保留原子会话为普通会话。UI 中的电脑、权限、模型、聊天运行状态都是演示数据，不能当作真实 Codex 的状态。

共享 App Server、OAuth 与其他协议代码不在视觉版本轮工作范围内，视觉首页不会调用它们。将来接入真实服务必须另作授权、审查接口和迁移数据结构，不能把演示 ID 当作服务器权威 ID。

## 图标与 Android 打包

用户上传的`assets/icon-source.png`是权威图源。使用
`scripts/make-visual-icon.py`（Pillow）去掉外围白色画布，生成黑底图标和白色标记的透明 adaptive foreground；保留标志原有几何结构，不额外添加白色边框。

项目原生目录通过 Expo prebuild 由 `app.json` 生成。稳定 Release 打包入口是
`scripts/build-android-stable.ps1`，使用**视觉版专用**的独立短路径构建目录，避免占用原 OAuth 构建缓存。检查 Expo/Gradle/Kotlin 包名、签名、APK 身份与嵌入的 JS。
本地测试 APK 使用测试签名，**不代表生产签名**。
首次 Release 编译在视觉版独立构建目录创建其专属测试签名文件，后续编译复用，以确保安装更新可用；此文件不入库，也不会复用原 OAuth 应用签名。

Gradle 的完整标准输出和错误输出会写到独立构建目录的
`.tmp/gradle-release-output.log`（不纳入 Git）；即使 CCM 终端会话中断，也应从该文件获取实际编译结果，而不是只看 PowerShell Transcript 或构建锁。

## 验证情况

- TypeScript 与本地 reducer/协议测试均可由 `npm run check` 执行。
- 红米 K80 真机上的键盘避让、录音服务、项目列表滚动位置、WebView 页面和 Android 返回键尚未验证；**代码检查或 APK 编译成功均不能代替实机验证**。
- 编译/上传结果以实际 CCM 构建核验为准；不使用先前采用主线包名的旧视觉 APK。
- 2026-11-05 已成功生成 `CodexMobile-visual-0.3.0-release-arm64.apk`：Android 包名 `dev.codexmobileui.visual`、versionCode 1；构建脚本确认 APK v2 签名有效且内嵌 JS Bundle（2,933,136 字节）。使用专属测试签名，文件 SHA-256 是 `BA33A9B5BDDF3AC495424FBEADC4D2C43CD4D9C1616BFA8956F7FAF845ADC3F6`，APK 共 38,486,033 字节。CCM 夸克上传到「上传文件」，回报 `FINISH`、100%，远端大小与本地一致；这不等于红米 K80 实机功能已通过验收。

项目开发规则见 `AGENTS.md`，验收清单见 `docs/roadmap.md`。
