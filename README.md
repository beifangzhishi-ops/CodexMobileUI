# CodexMobile 视觉版

## 电脑端视觉编辑环境

- 6v 已配置 Android Studio 与 `Medium_Phone_API_37.0` 虚拟手机，ADB 可以识别 `emulator-5554` 且 Android 启动完成。
- 已加入仅用于开发的 Storybook 10.6.7、React Native Storybook 10.7.1、Lite UI 10.7.1 和 Controls 10.7.1；`esbuild` 0.28.2 命令可运行。安装过程中 CCM 对单条 npm 命令授予所需权限，没有设置全局永久免审批。
- 已实现本地浏览器参数编辑器 `scripts/visual-editor.mjs`（`http://127.0.0.1:49173/`），具备临时预览、撤销、保存到源码、输入安全校验、手机布局缩略图和 Logo 比例预览。
- `src/ui/visual-tokens.json` 是调参保存源；开发版模拟器通过 `src/ui/visual-tokens.ts` 读取本机预览参数，普通 App 绝不连接该开发服务。
- 双击 `Start-Visual-Workbench.cmd` 可启动编辑器和 Metro；详细说明见 `docs/visual-workbench.md`。Storybook 开发依赖已安装，但当前调参面板是独立浏览器工具，尚未接入 Storybook UI。
- **x86_64 Debug 开发版的安装和模拟器 Metro 连接必须单独验证**；已有 ARM64 Release APK 不具备热更新能力。Logo 修改保存后需重新生成 Android 原生图标并编译。

独立 Android 视觉测试应用。使用 Expo SDK 58、React Native 0.88 和 assistant-ui Native。
**本应用目前只运行本地交互模拟，不连接 Codex App Server，不执行真实命令、OAuth 或定时任务。**
此工作树不修改原有的 OAuth Android 应用、共享内核、Gateway 或 Funnel。

## 当前功能

### 0.3.2 视觉调整（待新版 APK 实机验收）

- 侧边栏默认宽度为屏幕的 80%，右侧保留约 20% 的遮罩区域；最大宽度 350dp。
- 项目行的加号和最近对话行的设置按钮紧跟各自标题，不再靠侧栏最右侧。
- 顶部应用名称与搜索按钮一起下移，搜索按钮恢复明显的圆形触摸区域。
- 底部蓝色新建聊天按钮及头像增大、整体上移；列表滚动留白跟随固定区高度，不遮挡内容。

- 侧边栏改为从屏幕左侧水平滑入、向左滑出，使用 React Native 原生驱动动画（240ms），遮罩独立渐变；不再使用整个 Modal 的淡入动画。
- 顶部与侧栏底部的新建聊天按钮统一使用白色写字板加笔的图形，而不是单独的铅笔字符。
- 使用原始上传图源重新生成图标：黑色背景不变，白色结形缩小到普通图标 610/1024、adaptive foreground 510/1024；同时更新 Android 原生 mipmap WebP，避免 APK 仍携带旧图标；不添加白边。
- 视觉版版本升级为 0.3.2（versionCode 3），沿用独立包名及测试签名，可在同一视觉版应用上升级；原 OAuth 应用不受影响。
- 视觉测试版 Release 构建关闭 R8 代码压缩以避开 Windows 构建机上的长时间优化阻塞，保留 Release 内嵌 JS 与独立测试签名；该 APK 不作为生产优化包。

- Android 包名：`dev.codexmobileui.visual`；版本：`0.3.2`（versionCode 3），与 OAuth 应用可并装。
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
- 视觉测试包 `CodexMobile-visual-0.3.2-release-arm64.apk` 已完成 Release 编译、包名/versionCode 3 校验、v2 签名以及内置 JS Bundle 检查（2,936,932 字节）。文件共 52,170,981 字节，SHA-256 为 `49EA474563F722E37058288FDA00D9FA0C6F72355CB7D776A3E3ACA95BC3E971`，与上一视觉版测试签名一致；CCM 夸克「上传文件」返回 `FINISH`、100%、远端大小一致。红米 K80 实机布局和动画仍需验收。

项目开发规则见 `AGENTS.md`，验收清单见 `docs/roadmap.md`。
