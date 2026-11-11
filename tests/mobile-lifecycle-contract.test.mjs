import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const launcher = readFileSync(new URL("../scripts/mobile-launcher.ps1", import.meta.url), "utf8");
const mobileStop = readFileSync(new URL("../Stop-CodexMobile.cmd", import.meta.url), "utf8");
const backend = readFileSync(new URL("../scripts/mobile-app-server.ps1", import.meta.url), "utf8");
const oauthLogin = readFileSync(new URL("../src/auth/Login.tsx", import.meta.url), "utf8");
const appSettings = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const mainApp = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const chatThread = readFileSync(new URL("../src/ui/ChatThread.tsx", import.meta.url), "utf8");
const diagnosticsPanel = readFileSync(new URL("../src/diagnostics/DiagnosticsPanel.tsx", import.meta.url), "utf8");
const diagnosticsExport = readFileSync(new URL("../src/diagnostics/export.ts", import.meta.url), "utf8");
const diagnosticsJournal = readFileSync(new URL("../src/diagnostics/journal.ts", import.meta.url), "utf8");
const packageSettings = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const androidStableBuild = readFileSync(new URL("../scripts/build-android-stable.ps1", import.meta.url), "utf8");
const androidWindowsBuild = readFileSync(new URL("../scripts/build-android-windows.ps1", import.meta.url), "utf8");

test("Android real-chat composer stays in a keyboard-avoiding layout", () => {
  assert.match(chatThread, /KeyboardAvoidingView style=\{styles\.keyboardAvoiding\} behavior="padding"/);
  assert.match(chatThread, /<KeyboardAvoidingView[\s\S]*<ThreadPrimitive\.MessagesFlatList[\s\S]*<Composer host=\{host\} session=\{session\} \/>[\s\S]*<\/KeyboardAvoidingView>/);
  assert.match(chatThread, /keyboardAvoiding: \{ flex: 1 \}/);
  assert.equal(appSettings.expo.android.softwareKeyboardLayoutMode, "resize");
});

test("starting MobileUI starts the dedicated backend before Gateway", () => {
  assert.match(launcher, /Invoke-HostService \$backendScript 'start'/);
  assert.match(launcher, /Invoke-HostService \$gatewayScript 'start'/);
  assert.ok(launcher.indexOf("Invoke-HostService $backendScript 'start'") <
    launcher.indexOf("Invoke-HostService $gatewayScript 'start'"));
  assert.match(backend, /CODEX_HOME = \$homeRoot/);
});

test("normal MobileUI shutdown stops its own Gateway then its own App Server", () => {
  assert.match(launcher, /Invoke-HostService \$gatewayScript 'stop'/);
  assert.match(launcher, /Invoke-HostService \$backendScript 'stop'/);
  assert.ok(launcher.indexOf("Invoke-HostService $gatewayScript 'stop'") <
    launcher.indexOf("Invoke-HostService $backendScript 'stop'"));
  assert.match(mobileStop, /mobile-launcher\.ps1" -Action stop/);
  assert.doesNotMatch(launcher, /hot.attach/i);
});

test("mobile OAuth tap creates a fresh request instead of silently disabling its button", () => {
  assert.match(oauthLogin, /onPress=\{\(\) => \{ void authorize\(\); \}\}/);
  assert.match(oauthLogin, /new AuthSession\.AuthRequest\(/);
  assert.match(oauthLogin, /await request\.makeAuthUrlAsync\(discovery\)/);
  assert.match(oauthLogin, /await request\.promptAsync\(discovery\)/);
  assert.match(oauthLogin, /getAuthorizedCode\(result, request\.state\)/);
  assert.match(oauthLogin, /setPhase\('正在创建新的安全授权请求/);
  assert.match(oauthLogin, /setError\('系统中还有一个授权浏览器/);
  assert.doesNotMatch(oauthLogin, /AuthSession\.useAuthRequest\(/);
  assert.doesNotMatch(oauthLogin, /disabled=\{!request/);
  assert.equal(appSettings.expo.android.package, "dev.codexmobileui.app");
  assert.ok(Number.isInteger(appSettings.expo.android.versionCode) && appSettings.expo.android.versionCode > 3);
});

test("Android version metadata is consistent across Expo, npm and lockfile", () => {
  assert.equal(appSettings.expo.version, packageSettings.version);
  assert.equal(packageLock.version, packageSettings.version);
  assert.equal(packageLock.packages[""].version, packageSettings.version);
});

test("Windows stable Android build uses isolated reusable native caches and verifies the APK", () => {
  assert.match(androidStableBuild, /CodexMobileUI-AndroidBuild/);
  assert.match(androidStableBuild, /outside the source checkout/);
  assert.match(androidStableBuild, /stable-build\.lock/);
  assert.match(androidStableBuild, /Assert-AvailableLock/);
  assert.match(androidStableBuild, /Reusing installed dependencies and incremental Gradle\/CMake caches/);
  assert.match(androidStableBuild, /Get-DependencyLockContent/);
  assert.match(androidStableBuild, /node_modules\\expo-modules-autolinking\\build\\index\.js/);
  assert.match(androidStableBuild, /Start-Transcript/);
  assert.match(androidStableBuild, /versionCode=/);
  assert.match(androidStableBuild, /certificate SHA-256 digest/);
  assert.match(androidStableBuild, /android-artifacts/);
});

test("stable Android release writes Gradle cache and temp files inside this checkout", () => {
  assert.match(androidStableBuild, /\$workspaceCacheRoot = Join-Path \$sourceRoot '\.tmp'/);
  assert.match(androidStableBuild, /\$sourceBuilder -Variant \$Variant -UseWorkspaceCache -WorkspaceCacheRoot \$workspaceCacheRoot -CheckOnly/);
  assert.match(androidStableBuild, /\$builder -Variant \$Variant -UseWorkspaceCache -WorkspaceCacheRoot \$workspaceCacheRoot -GradleLogPath \$gradleLog/);
  assert.match(androidStableBuild, /\$builder -Variant \$Variant -UseWorkspaceCache -WorkspaceCacheRoot \$workspaceCacheRoot -RegenerateCMake -GradleLogPath \$gradleLog/);
  assert.match(androidWindowsBuild, /\$env:GRADLE_USER_HOME = Join-Path \$cacheParent 'gradle-user'/);
  assert.match(androidWindowsBuild, /\$env:TEMP = Join-Path \$cacheParent 'build-temp'/);
  assert.match(androidWindowsBuild, /\$env:TMP = \$env:TEMP/);
  assert.match(androidWindowsBuild, /\$gradleCommand = \$candidate/);
  assert.match(androidWindowsBuild, /installed Gradle \$gradleVersion distribution with isolated writable workspace cache/);
});

test("device diagnostics are reachable before authorization and export a persistent JSON file", () => {
  assert.match(mainApp, /accessibilityLabel="诊断日志"/);
  assert.match(mainApp, /<DiagnosticsPanel visible=\{diagnosticsOpen\}/);
  assert.match(mainApp, /logDiagnostic\('app\.deepLinkReceived'/);
  assert.match(oauthLogin, /onPressIn=\{\(\) => logDiagnostic\('auth\.pressIn'/);
  assert.match(oauthLogin, /logDiagnostic\('auth\.browserPromptStarted'/);
  assert.match(oauthLogin, /logDiagnostic\('auth\.browserPromptFinished'/);
  assert.match(oauthLogin, /logDiagnostic\('auth\.browserStillPending'/);
  assert.match(diagnosticsPanel, /exportDiagnostics\(\)/);
  assert.match(diagnosticsPanel, /nativeBuildVersion/);
  assert.match(mainApp, /componentDidCatch\(error: Error\)/);
  assert.match(mainApp, /diagnostics\.crashScreenPressed/);
  assert.match(diagnosticsExport, /new File\(Paths\.cache/);
  assert.match(diagnosticsExport, /Sharing\.shareAsync\(file\.uri/);
  assert.match(diagnosticsJournal, /codexmobileui-diagnostics\.db/);
  assert.match(diagnosticsJournal, /ORDER BY id DESC LIMIT/);
});
