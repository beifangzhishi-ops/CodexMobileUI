import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = read('App.tsx');
const webApp = read('web/src/DesktopApp.tsx');
const uiStyle = read('web/src/desktop.css');
const client = read('web/src/useLiveCodex.ts');
const bridge = read('web/server/bridge.mjs');
const config = JSON.parse(read('app.json'));
const packageFile = JSON.parse(read('package.json'));

test('conversation context and native-history refresh stay above the scrolling messages', () => {
  const context = webApp.indexOf('<div className="chat-context">');
  const scroller = webApp.indexOf('<div className="message-scroller"');
  const messages = webApp.indexOf('<div className="messages-wrap" ref={contentRef}>');
  assert.ok(context >= 0 && context < scroller && scroller < messages);
  assert.match(uiStyle, /\.chat-context\s*\{[^}]*flex:\s*none/);
  assert.match(uiStyle, /\.message-scroller\s*\{[^}]*overflow-y:\s*auto/);
});

test('new-chat draft survives host/project navigation without rotating transient IDs', () => {
  assert.match(webApp, /const draftKey = active \? 'thread:'[\s\S]+? : 'new:draft';/);
  assert.match(webApp, /navigationKey\.current = 'new:draft'/);
  assert.doesNotMatch(webApp, /setNewChatId|setNewChatId\(/);
  assert.match(webApp, /'new:draft': draft/);
});

test('Android diagnostics and mobile settings remain accessible and scrollable', () => {
  const settings = read('web/src/SettingsView.tsx');
  assert.match(app, /<DiagnosticsPanel visible=\{diagnosticsOpen\}/);
  assert.match(app, /codexmobileui:diagnostics:open/);
  assert.match(settings, /codexmobileui:diagnostics:open/);
  assert.match(uiStyle, /\.modal-backdrop\.settings-backdrop\s*\{[^}]*align-items: center/);
  assert.match(uiStyle, /\.shared-settings > \*\s*\{\s*flex-shrink: 0/);
  assert.match(uiStyle, /\.shared-settings\s*\{[^}]*overflow-y: auto/);
});

test('native model is per-thread and new threads prewarm the chosen model', () => {
  assert.match(webApp, /active\?\.model/);
  assert.match(client, /thread\/settings\/update/);
  assert.match(client, /modelUpdates\.current\.get\(key\)/);
  assert.match(client, /web\/start'[\s\S]*?model: nativeModel\.id/);
  assert.match(bridge, /model_reasoning_effort: request\.params\.effort/);
  assert.match(bridge, /MODEL_UPDATE_REJECTED/);
});

test('one React UI owns conversations on browser, Android and future desktop', () => {
  assert.match(app, /<WebView<WebViewProps>/);
  assert.match(app, /unifiedWebUrl\(coordinator\)/);
  assert.match(app, /originWhitelist=\{\[origin\]\}/);
  assert.match(app, /onShouldStartLoadWithRequest=\{allowNavigation\}/);
  assert.doesNotMatch(app, /<ChatView|<ChatSidebar|<AccountScreen|useCodexSession/);
  assert.match(webApp, /const live = useLiveCodex\(\)/);
  assert.match(webApp, /<MessageMarkdown/);
  assert.match(webApp, /className=\{'sidebar-rail'/);
  assert.match(uiStyle, /@media \(max-width: 800px\)/);
});

test('Android retains Tailnet onboarding and a safe retry screen, but not the old UI', () => {
  assert.match(app, /loadCoordinatorUrl\(\)/);
  assert.match(app, /storeCoordinatorUrl\(selected\)/);
  assert.doesNotMatch(app, /discoverTailnetHosts|storeDiscoveredHosts|http:\/\/100\./);
  assert.match(app, /new URL\(navigation\.url\)\.origin === origin/);
  assert.match(app, /onError=\{\(\) => setError/);
  assert.match(app, /codexmobileui:back/);
  assert.match(webApp, /codexmobileui:configure/);
  assert.doesNotMatch(app, /OAuthLogin|src\/ui\/ChatView|src\/session\/useCodexSession/);
  assert.equal(config.expo.android.package, 'dev.codexmobileui.app');
  assert.equal(config.expo.scheme, 'codexmobileui');
  assert.equal(config.expo.version, packageFile.version);
});

test('Android native release does not allow HTTP or cleartext notification channels', () => {
  const nativeNotifications = read('native/notifications/NotificationListenerService.kt');
  const androidNotifications = read('android/app/src/main/java/dev/codexmobileui/app/NotificationListenerService.kt');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  assert.equal(config.expo.android.usesCleartextTraffic, false);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  for (const text of [nativeNotifications, androidNotifications]) {
    assert.match(text, /wss:\/\//);
    assert.match(text, /replaceFirst\("wss:", "https:"\)/);
    assert.doesNotMatch(text, /"ws:\/\//);
    assert.doesNotMatch(text, /"http:\/\//);
  }
});

test('project creation uses the chosen host and server-issued opaque directory locator', () => {
  const modal = read('web/src/ProjectCreateDialog.tsx');
  assert.match(webApp, /<ProjectCreateDialog/);
  assert.match(modal, /web\/projectDirectories/);
  assert.match(modal, /web\/projectCreate/);
  assert.match(modal, /idempotencyKey: idem\.current/);
  assert.match(modal, /locator: listing\.locator/);
  assert.match(bridge, /resolveProjectDirectory\(msg\.params\.locator\)/);
  assert.match(bridge, /internalRequest\('project\/create'/);
  assert.doesNotMatch(modal, /fs\/createDirectory/);
});

test('automation is served by the existing per-host Gateway scheduler, never a second writer', () => {
  const tasks = read('web/src/AutomationView.tsx');
  assert.match(webApp, /<AutomationView/);
  assert.match(tasks, /automation\/list/);
  assert.match(tasks, /automation\/create/);
  assert.match(tasks, /automation\/toggle/);
  assert.match(tasks, /automation\/runs/);
  assert.match(bridge, /requestLocalGateway\(msg\.params\.method, msg\.params\.params\)/);
  assert.match(bridge, /automationMethods/);
  assert.doesNotMatch(bridge, /new SchedulerService/);
});

test('shared settings use real host-owned files with revision checks and unsaved confirmation', () => {
  const settings = read('web/src/SettingsView.tsx');
  assert.match(webApp, /<SettingsView/);
  assert.match(settings, /workspace\/hostFileRead/);
  assert.match(settings, /workspace\/hostFileWrite/);
  assert.match(settings, /revision: source\.revision/);
  assert.match(settings, /askDiscard\(\)/);
  assert.match(settings, /codexmobileui:back/);
  assert.match(bridge, /web\/hostFile/);
  assert.match(bridge, /workspace\/hostFileWrite/);
  assert.doesNotMatch(bridge, /arbitraryFileRead/);
});

test('canonical assistant links preserve native Markdown and use opaque publication IDs', () => {
  const markdown = read('web/src/MessageMarkdown.tsx');
  const publication = read('web/src/publicationDownload.ts');
  const preview = read('web/src/PublicationPreview.tsx');
  const publications = read('gateway/publications.ts');
  const nativeSink = read('src/core/nativePublicationDownload.ts');
  assert.match(markdown, /renderableLocalFileLinks\(preview\.markdown\)/);
  assert.match(markdown, /onOpenFile\(path, link\.index\)/);
  assert.doesNotMatch(markdown, /dangerouslySetInnerHTML|rehypeRaw/);
  assert.match(webApp, /<PublicationPreview/);
  assert.match(publication, /workspace\/publication\/publish/);
  assert.match(publication, /workspace\/publication\/read/);
  assert.match(publication, /publication\.cancel/);
  assert.match(publications, /listForThread\(threadId: string\)/);
  assert.match(publications, /publishFromThread/);
  assert.doesNotMatch(publications, /uploadToQuark|quarkUpload/);
  assert.match(nativeSink, /Paths\.cache/);
  assert.match(nativeSink, /Directory\.pickDirectoryAsync\(\)/);
  assert.match(nativeSink, /job\.staging\.copy\(destination\)/);
  assert.match(nativeSink, /DOWNLOAD_INCOMPLETE/);
  assert.match(nativeSink, /safePublicationFileName/);
  assert.match(nativeSink, /publication\.cancel/);
  assert.match(nativeSink, /DOWNLOAD_IDLE_TIMEOUT_MS/);
  assert.match(bridge, /workspace\/publication\/publish/);
  assert.match(bridge, /workspace\/publication\/stat/);
  assert.match(bridge, /Content-Range/);
  assert.match(bridge, /web\/publication/);
  assert.match(preview, /sandbox=""/);
  assert.match(preview, /getDocument/);
  assert.match(preview, /publication-pdf-canvas/);
  assert.match(read('web/package.json'), /pdfjs-dist/);
  assert.match(preview, /复制私有链接/);
  assert.match(preview, /保存到系统/);
  assert.match(preview, /在资源管理器中定位/);
});

test('desktop sidebar resize and native fork controls follow the shared visual tools', () => {
  assert.match(webApp, /role="separator" aria-label="调整侧栏宽度"/);
  assert.match(webApp, /beginSidebarResize/);
  assert.match(uiStyle, /width: var\(--sidebar-width,310px\)/);
  assert.match(uiStyle, /\.sidebar-resizer\s*\{/);
  assert.match(uiStyle, /@media \(max-width: 800px\)[\s\S]*?\.sidebar-resizer \{ display: none; \}/);
  assert.match(webApp, /从最近回复创建分支/);
  assert.match(webApp, /title="从此轮助手回复创建分支"/);
  assert.match(uiStyle, /\.message-tools button\s*\{[^}]*width: 36px[^}]*height: 32px/);
});

test('shared frontend keeps real status, events, permissions, models and image upload', () => {
  assert.match(client, /turn\/steer/);
  assert.match(client, /thread\/queue\/add/);
  assert.match(client, /thread\/goal\/set/);
  assert.match(client, /thread\/settings\/update/);
  assert.match(client, /thread\/resume/);
  assert.match(client, /web\/image\/start/);
  assert.match(webApp, /<MessageImage/);
  assert.match(webApp, /<ToolImage/);
  assert.match(webApp, /WebQuotaRing/);
  assert.match(webApp, /followUpMode/);
  assert.match(webApp, /className="composer-actions"/);
});
