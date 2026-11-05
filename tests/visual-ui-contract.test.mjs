import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sidebar = readFileSync(new URL('../src/ui/ChatSidebar.tsx', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../src/ui/DemoChat.tsx', import.meta.url), 'utf8');
const account = readFileSync(new URL('../src/ui/AccountScreen.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const state = readFileSync(new URL('../src/demo/conversations.ts', import.meta.url), 'utf8');
const persistence = readFileSync(new URL('../src/demo/persistence.ts', import.meta.url), 'utf8');
const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
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
  assert.match(chat, /setPanel\(panel === 'model'/);
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
  assert.match(nativeBuilder, /if \(\$gradleExitCode -ne 0\)/);
  assert.match(nativeBuilder, /if \(\$Variant -eq 'Release'\)/);
  assert.match(nativeBuilder, /android\\app\\debug\.keystore/);
  assert.match(nativeBuilder, /-alias androiddebugkey -keyalg RSA/);
  assert.match(nativeBuilder, /if \(-not \(Test-Path -LiteralPath \$testKeystore\)\)/);
});

test('visual APK artifact filename cannot be confused with the OAuth mainline', () => {
  assert.match(stableBuilder, /CodexMobile-visual-\$appVersion-\$lower-arm64\.apk/);
});
