import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relative) => readFileSync(new URL('../' + relative, import.meta.url), 'utf8');
const app = read('App.tsx');
const chat = read('src/ui/ChatView.tsx');
const sidebar = read('src/ui/ChatSidebar.tsx');
const picker = read('src/ui/ChatSetupPicker.tsx');
const menu = read('src/ui/ConversationMenu.tsx');
const account = read('src/ui/AccountScreen.tsx');
const session = read('src/session/useCodexSession.ts');
const preferences = read('src/ui/preferences.ts');
const rpcPolicy = read('gateway/rpcPolicy.ts');
const config = JSON.parse(read('app.json'));
const packageFile = JSON.parse(read('package.json'));

test('visual baseline controls, drawer animation and design tokens are retained', () => {
  assert.match(app, /useVisualTokens\(\)/);
  assert.match(app, /ReferenceIcon name="menu"/);
  assert.match(app, /ReferenceIcon name="ellipsis"/);
  assert.match(app, /<ChatSidebar/);
  assert.match(app, /<ChatView/);
  assert.match(chat, /Animated\.spring\(composerRise/);
  assert.match(sidebar, /Animated\.timing\(drawerProgress/);
  assert.match(sidebar, /sidebarSlideDurationMs/);
  assert.match(sidebar, /sortConversations\(conversations\)/);
  assert.match(sidebar, /sortProjects\(projects\)/);
  assert.match(sidebar, /onLongPress/);
  assert.match(chat, /ChatSetupPicker/);
  assert.match(picker, /onChooseHost/);
  assert.match(picker, /onChooseProject/);
  assert.match(menu, /copy-id/);
  assert.match(menu, /archive/);
  assert.match(menu, /delete/);
  assert.match(account, /连接新的电脑/);
});

test('visual screens use the real native Codex profile rather than local simulation', () => {
  assert.match(app, /useCodexSession\(authorized \? currentHost : null\)/);
  assert.match(app, /<OAuthLogin host=\{currentHost\}/);
  assert.match(app, /session\.threads/);
  assert.match(app, /session\.archivedThreads/);
  assert.match(app, /session\.messages/);
  assert.match(app, /session\.send\(draft\.trim\(\), expected, settings\)/);
  assert.match(app, /session\.createThread/);
  assert.match(app, /session\.moveThread/);
  assert.match(app, /session\.renameProject/);
  assert.match(app, /session\.archiveThread/);
  assert.match(app, /session\.deleteThread/);
  assert.match(app, /session\.createProject/);
  assert.doesNotMatch(app, /demoReducer|initialDemoState|setTimeout\(\(\) => \{\s*dispatch\(\{ type: 'reply'/);
  assert.doesNotMatch(chat, /DemoConversation|demoReducer|src\/demo/);
});

test('model and reasoning controls use native catalog, permission never grants fake Full Access', () => {
  assert.match(session, /connection\.request\('model\/list'/);
  assert.match(chat, /availableModels\.map/);
  assert.match(chat, /settingsForTurn/);
  assert.match(session, /turn\/start/);
  assert.match(chat, /当前 Gateway 不允许手机客户端改变审批或沙箱权限/);
  assert.match(rpcPolicy, /case 'turn\/start'/);
  assert.doesNotMatch(chat, /GPT-6\.1 Sol/);
});

test('visual preferences do not overwrite native threads, and mobile identity is unchanged', () => {
  assert.match(preferences, /codexmobileui-ui-settings\.db/);
  assert.match(preferences, /pinnedThreads/);
  assert.match(preferences, /projectRules/);
  assert.match(app, /loadHosts\(\)/);
  assert.equal(config.expo.android.package, 'dev.codexmobileui.app');
  assert.equal(config.expo.scheme, 'codexmobileui');
  assert.equal(config.expo.version, packageFile.version);
  assert.equal(config.expo.icon, './assets/icon.png');
  assert.equal(config.expo.android.adaptiveIcon.backgroundColor, '#000000');
  assert.ok(config.expo.android.versionCode > 7);
});
