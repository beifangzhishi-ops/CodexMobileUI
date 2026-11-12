import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sidebar = readFileSync(new URL('../src/ui/ChatSidebar.tsx', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../src/ui/DemoChat.tsx', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../src/ui/ChatSetupPicker.tsx', import.meta.url), 'utf8');
const contextMenu = readFileSync(new URL('../src/ui/ConversationMenu.tsx', import.meta.url), 'utf8');
const account = readFileSync(new URL('../src/ui/AccountScreen.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const state = readFileSync(new URL('../src/demo/conversations.ts', import.meta.url), 'utf8');
const persistence = readFileSync(new URL('../src/demo/persistence.ts', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const visualDefaults = JSON.parse(readFileSync(new URL('../src/ui/visual-tokens.json', import.meta.url), 'utf8'));
const nativeBuilder = readFileSync(new URL('../scripts/build-android-windows.ps1', import.meta.url), 'utf8');
const stableBuilder = readFileSync(new URL('../scripts/build-android-stable.ps1', import.meta.url), 'utf8');

test('sidebar has independent project, project-thread and recent-thread limits', () => {
  assert.match(sidebar, /sortedProjects\.slice\(0, 5\)/);
  assert.match(sidebar, /children\.slice\(0, 5\)/);
  assert.match(sidebar, /useState\(10\)/);
  assert.match(sidebar, /allRecent\.slice\(0, recentLimit\)/);
  assert.match(sidebar, /setRecentLimit\(\(n\) => n \+ 10\)/);
  assert.match(sidebar, /加载更多对话/);
  assert.match(sidebar, /展开全部项目/);
  assert.match(sidebar, /展开全部对话/);
  assert.match(sidebar, /onIncludeProjectConversations\(!includeProjectConversations\)/);
  assert.match(sidebar, /onLongPress=\{\(\) => longPress\('project'/);
  assert.match(sidebar, /onLongPress=\{\(\) => longPress\('conversation'/);
});

test('sidebar marks only running or unread conversations on their right', () => {
  assert.match(sidebar, /if \(item\.running\)/);
  assert.match(sidebar, /if \(item\.unread\)/);
  assert.match(sidebar, /styles\.status/);
  assert.doesNotMatch(sidebar, /item\.status === 'completed'/);
  assert.match(state, /case 'read'/);
  assert.match(state, /unread: !action\.visible/);
});

test('visual edition composer uses explicit Android keyboard avoidance and non-authoritative model/permission selectors', () => {
  assert.match(app, /<KeyboardAvoidingView style=\{styles\.keyboardLayout\} behavior="padding"/);
  assert.match(chat, /setPanel\(panel === 'effort'/);
  assert.match(chat, /setPanel\('model'\)/);
  assert.match(chat, /setPanel\(panel === 'permission'/);
  assert.match(chat, /useSpeechRecognitionEvent\('result'/);
  assert.match(chat, /ExpoSpeechRecognitionModule\.requestPermissionsAsync\(\)/);
  assert.match(chat, /ExpoSpeechRecognitionModule\.isRecognitionAvailable\(\)/);
  assert.match(chat, /ExpoSpeechRecognitionModule\.stop\(\)/);
  assert.match(chat, /ExpoSpeechRecognitionModule\.abort\(\)/);
  assert.doesNotMatch(chat, /useCodexSession|turn\/start/);
});

test('offline machine page and separate SQLite state do not touch OAuth or real Codex session data', () => {
  assert.match(account, /连接新的电脑/);
  assert.match(account, /全局规则纯文本/);
  assert.match(account, /FullRulesEditor/);
  assert.match(app, /CONNECTION_TEST_HTML/);
  assert.match(state, /export const CONNECT_PROMPT = '请点击左上角菜单-下方头像连接电脑'/);
  assert.match(persistence, /codexmobile-visual-v1\.db/);
  assert.doesNotMatch(app, /useCodexSession|thread\/start|promptAsync/);
  assert.equal(config.expo.android.package, 'dev.codexmobileui.visual');
  assert.equal(config.expo.icon, './assets/icon.png');
  assert.equal(config.expo.android.adaptiveIcon.backgroundColor, '#000000');
});

test('native Android Release build writes independent Gradle log and checks exit code', () => {
  assert.match(nativeBuilder, /gradle-\$\(\$Variant\.ToLowerInvariant\(\)\)-output\.log/);
  assert.match(nativeBuilder, /2>&1 \| Tee-Object -FilePath \$gradleOutput/);
  assert.match(nativeBuilder, /\$gradleExitCode = \$LASTEXITCODE/);
  assert.match(nativeBuilder, /-Pandroid\.enableMinifyInReleaseBuilds=false/);
  assert.match(nativeBuilder, /if \(\$gradleExitCode -ne 0\)/);
  assert.match(nativeBuilder, /if \(\$Variant -eq 'Release'\)/);
  assert.match(nativeBuilder, /android\\app\\debug\.keystore/);
  assert.match(nativeBuilder, /-alias androiddebugkey -keyalg RSA/);
  assert.match(nativeBuilder, /if \(-not \(Test-Path -LiteralPath \$testKeystore\)\)/);
});

test('visual APK artifact filename cannot be confused with the OAuth mainline', () => {
  assert.match(stableBuilder, /CodexMobile-visual-\$appVersion-\$lower-arm64\.apk/);
  assert.match(stableBuilder, /'--legacy-peer-deps'/);
  assert.match(stableBuilder, /Join-Path \$stateDir 'npm-cache'/);
});

test('sidebar slides from left with native animation and keeps its board-and-pen button', () => {
  assert.match(sidebar, /Animated\.timing\(drawerProgress/);
  assert.match(sidebar, /useNativeDriver: true/);
  assert.match(sidebar, /onShow=\{\(\) => \{ if \(visible\) setModalReady\(true\); \}\}/);
  assert.match(sidebar, /if \(!modalReady\)/);
  assert.match(sidebar, /hardwareAccelerated/);
  assert.match(sidebar, /renderToHardwareTextureAndroid/);
  assert.match(sidebar, /Easing\.out\(Easing\.cubic\)/);
  assert.match(sidebar, /isInteraction: false/);
  assert.match(sidebar, /animationType="none"/);
  assert.match(sidebar, /translateX: drawerProgress\.interpolate/);
  assert.match(sidebar, /<NewChatIcon size=\{visual\.newChatIconSize\}/);
  assert.doesNotMatch(app, /<NewChatIcon /);
  assert.match(app, /name="ellipsis"/);
  assert.doesNotMatch(sidebar, /animationType="fade"/);
});

test('project conversations show the project title and offer local conversation operations', () => {
  assert.match(app, /activeProject\?\.name \?\? 'CodexMobile'/);
  assert.match(app, /setConversationMenuOpen\(true\)/);
  assert.match(app, /onAction=\{conversationAction\}/);
  assert.match(app, /Clipboard\.setStringAsync\(id\)/);
  assert.match(app, /conversation-remove-project/);
  assert.match(app, /conversation-archive/);
  assert.match(app, /conversation-delete/);
  for (const label of ['复制对话串 ID', '置顶', '从项目中移除', '在聊天中查找', '归档', '删除']) {
    assert.ok(contextMenu.includes(label), `missing action ${label}`);
  }
  assert.match(chat, /searchOpen && searchQuery\.trim\(\)/);
  assert.match(chat, /matchingMessages/);
  assert.match(sidebar, /showArchived \? '已归档对话' : '最近对话'/);
});

test('new conversation has local machine and project pickers and a project-row plus', () => {
  assert.match(chat, /<ChatSetupPicker/);
  assert.match(setup, /accessibilityLabel="选择机器"/);
  assert.match(setup, /accessibilityLabel="选择项目"/);
  assert.match(setup, /onChooseHost\(id\)/);
  assert.match(setup, /onChooseProject\(id\)/);
  assert.match(setup, /onAddHost\(newHostName\.trim\(\)\)/);
  assert.match(setup, /仅配置本地视觉演示机器/);
  assert.match(sidebar, /onNew\(project\.id\)/);
  assert.match(sidebar, /styles\.projectNewChat/);
  assert.match(sidebar, /conversationName: \{ flex: 1, color: '#dcdcdc', fontSize: 15/);
  assert.doesNotMatch(app, /accessibilityLabel="新建聊天"/);
});

test('project expansion and composer popups animate without blocking keyboard avoidance', () => {
  assert.match(sidebar, /LayoutAnimation\.configureNext\(expandAnimation\)/);
  assert.match(sidebar, /function ProjectDisclosure/);
  assert.match(sidebar, /rotate: progress\.interpolate/);
  assert.match(sidebar, /setOpenProjects\(\(ids\)/);
  assert.match(sidebar, /setAllProjectConversations\(\(ids\)/);
  assert.match(chat, /const panelProgress = useRef\(new Animated\.Value\(0\)\)/);
  assert.match(chat, /const composerRise = useRef\(new Animated\.Value\(0\)\)/);
  assert.match(chat, /onFocus=\{liftComposerOnFocus\}/);
  assert.match(chat, /displayedPanel && <Animated\.View/);
  assert.match(chat, /opacity: panelProgress/);
  assert.match(chat, /scale: panelProgress\.interpolate/);
  assert.match(app, /<KeyboardAvoidingView style=\{styles\.keyboardLayout\} behavior="padding"/);
});

test('updated Android visual edition has independent upgrade version', () => {
  assert.equal(config.expo.version, '0.3.5');
  assert.equal(config.expo.android.versionCode, 6);
});

test('sidebar proportions and controls match visual review feedback', () => {
  assert.equal(visualDefaults.sidebarWidthPercent, 80, 'leave a visible 20% right-side strip');
  assert.equal(visualDefaults.sidebarTopHeight, 118, 'lower title and search together');
  assert.equal(visualDefaults.sidebarBottomHeight, 120, 'lift the bottom fixed controls');
  assert.equal(visualDefaults.newChatHeight, 54);
  assert.equal(visualDefaults.newChatIconSize, 25);
  assert.match(sidebar, /sectionHead: \{[^\n]*justifyContent: 'flex-start'/);
  assert.match(sidebar, /topBar: \{[^\n]*paddingTop: 46/);
  assert.match(sidebar, /bottomBar: \{[^\n]*paddingLeft: 30/);
  assert.match(sidebar, /profile: \{ height: 55, width: 55/);
  assert.match(sidebar, /paddingBottom: visual\.sidebarBottomHeight \+ 16/);
});

test('visual reference icons replace text glyphs and both sidebar fades are continuous SVG gradients', () => {
  const icons = readFileSync(new URL('../src/ui/ReferenceIcons.tsx', import.meta.url), 'utf8');
  assert.match(icons, /export function ReferenceIcon/);
  for (const name of ['mic', 'wave', 'hand', 'shield-check', 'shield-lock', 'warning', 'folder', 'clock', 'compose', 'search', 'chevron-right', 'chevron-down']) {
    assert.ok(icons.includes(`case '${name}'`), `Missing ${name} vector icon`);
  }
  assert.match(sidebar, /<LinearGradient id="sidebarHeaderFade"/);
  assert.match(sidebar, /<LinearGradient id="sidebarFooterFade"/);
  assert.doesNotMatch(sidebar, /topFadeLight|bottomFadeLight/);
  assert.match(sidebar, /sidebarTopHeight - 33/);
  assert.match(sidebar, /<ReferenceIcon name="clock"/);
  assert.match(sidebar, /<ReferenceIcon name="folder"/);
  assert.match(chat, /<ReferenceIcon name="mic"/);
  assert.match(chat, /<ReferenceIcon name="wave"|\? 'arrow-up' : 'wave'/);
});

test('thinking effort is an explicitly local visual selector with model and speed submenus', () => {
  assert.match(chat, /const thinkingLevels = \['低', '中', '高', '极高', 'Max', 'Ultra'\]/);
  assert.match(chat, /setSelectedEffort\(item\)/);
  assert.match(chat, /setSelectedSpeed\(item\)/);
  assert.match(chat, /智能 · 思考强度（演示）/);
  assert.match(chat, /setPanel\('effort'\)/);
  assert.match(chat, /setPanel\('speed'\)/);
  assert.doesNotMatch(chat, /turn\/start|useCodexSession/);
});
