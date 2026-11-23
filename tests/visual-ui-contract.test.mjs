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

test('one React UI owns conversations on browser, Android and future desktop', () => {
  assert.match(app, /<WebView<WebViewProps>/);
  assert.match(app, /unifiedWebUrl\(coordinator\)/);
  assert.match(app, /originWhitelist=\{\[origin\]\}/);
  assert.match(app, /onShouldStartLoadWithRequest=\{allowNavigation\}/);
  assert.doesNotMatch(app, /<ChatView|<ChatSidebar|<AccountScreen|useCodexSession/);
  assert.match(webApp, /const live = useLiveCodex\(\)/);
  assert.match(webApp, /<MessageMarkdown/);
  assert.match(webApp, /className="sidebar-rail"/);
  assert.match(uiStyle, /@media \(max-width: 800px\)/);
});

test('Android retains Tailnet onboarding and a safe retry screen, but not the old UI', () => {
  assert.match(app, /loadCoordinatorUrl\(\)/);
  assert.match(app, /discoverTailnetHosts\(/);
  assert.match(app, /storeDiscoveredHosts\(selected, hosts\)/);
  assert.match(app, /new URL\(navigation\.url\)\.origin === origin/);
  assert.match(app, /onError=\{\(\) => setError/);
  assert.match(app, /codexmobileui:back/);
  assert.match(webApp, /codexmobileui:configure/);
  assert.doesNotMatch(app, /OAuthLogin|src\/ui\/ChatView|src\/session\/useCodexSession/);
  assert.equal(config.expo.android.package, 'dev.codexmobileui.app');
  assert.equal(config.expo.scheme, 'codexmobileui');
  assert.equal(config.expo.version, packageFile.version);
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
  const nativeSink = read('src/core/nativePublicationDownload.ts');
  assert.match(markdown, /renderableLocalFileLinks\(preview\.markdown\)/);
  assert.match(markdown, /onOpenFile\(path\)/);
  assert.match(webApp, /parsePublishedFiles/);
  assert.match(webApp, /downloadPublication\(/);
  assert.match(publication, /workspace\/publication\/read/);
  assert.match(nativeSink, /Paths\.document/);
  assert.match(nativeSink, /Sharing\.shareAsync/);
  assert.match(nativeSink, /DOWNLOAD_INCOMPLETE/);
  assert.match(bridge, /web\/publication/);
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
