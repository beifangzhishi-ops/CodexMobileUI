import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syncDiagnosticsNative } from "../scripts/sync-diagnostics-native.mjs";

const launcher = readFileSync(new URL("../scripts/mobile-launcher.ps1", import.meta.url), "utf8");
const mobileStop = readFileSync(new URL("../Stop-CodexMobile.cmd", import.meta.url), "utf8");
const backend = readFileSync(new URL("../scripts/mobile-app-server.ps1", import.meta.url), "utf8");
const appSettings = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const mainApp = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const coordinatorStorage = readFileSync(new URL("../src/storage/database.ts", import.meta.url), "utf8");
const nativeFileSave = readFileSync(new URL("../src/core/nativePublicationDownload.ts", import.meta.url), "utf8");
const diagnosticsExport = readFileSync(new URL("../src/diagnostics/export.ts", import.meta.url), "utf8");
const diagnosticsPanel = readFileSync(new URL("../src/diagnostics/DiagnosticsPanel.tsx", import.meta.url), "utf8");
const diagnosticsDownload = readFileSync(new URL("../native/diagnostics/DiagnosticsDownloadModule.kt", import.meta.url), "utf8");
const diagnosticsSync = readFileSync(new URL("../scripts/sync-diagnostics-native.mjs", import.meta.url), "utf8");
const splashColors = readFileSync(new URL("../android/app/src/main/res/values/colors.xml", import.meta.url), "utf8");
const splashStyles = readFileSync(new URL("../android/app/src/main/res/values/styles.xml", import.meta.url), "utf8");
const packageSettings = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const androidStableBuild = readFileSync(new URL("../scripts/build-android-stable.ps1", import.meta.url), "utf8");
const androidWindowsBuild = readFileSync(new URL("../scripts/build-android-windows.ps1", import.meta.url), "utf8");

test("Android uses the shared React WebView and native keyboard resize, not a second chat tree", () => {
  assert.match(mainApp, /<WebView<WebViewProps>/);
  assert.match(mainApp, /domStorageEnabled/);
  assert.match(mainApp, /KeyboardAvoidingView/);
  assert.doesNotMatch(mainApp, /<ChatView|<ChatSidebar|useCodexSession/);
  assert.equal(appSettings.expo.android.softwareKeyboardLayoutMode, "resize");
});

test("cold start resolves the stored Tailnet coordinator before showing shared UI", () => {
  assert.match(mainApp, /loadCoordinatorUrl\(\)/);
  assert.match(mainApp, /setBooting\(false\)/);
  assert.match(mainApp, /setConfiguring\(!valid\)/);
  assert.match(mainApp, /unifiedWebUrl\(coordinator\)/);
  assert.doesNotMatch(mainApp, /<OAuthLogin/);
});

test("native splash and web container stay dark until the shared UI loads", () => {
  assert.match(splashColors, /name="splashscreen_background">#000000</);
  assert.match(splashStyles, /name="android:windowBackground">@color\/splashscreen_background</);
  assert.match(mainApp, /backgroundColor: '#101010'/);
  assert.match(mainApp, /startInLoadingState/);
  assert.match(mainApp, /renderLoading=/);
});

test("private network onboarding stays recoverable without the old Android UI", () => {
  assert.match(mainApp, /storeCoordinatorUrl\(selected\)/);
  assert.doesNotMatch(mainApp, /discoverTailnetHosts|48889|http:\/\/100\./);
  assert.match(mainApp, /setAddress\(valid \?\? DEFAULT_COORDINATOR_URL\)/);
  assert.match(mainApp, /setReload\(\(value\) => value \+ 1\)/);
  assert.match(mainApp, /更改内网入口/);
  assert.match(mainApp, /onShouldStartLoadWithRequest=\{allowNavigation\}/);
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

test("Android onboarding is private Tailnet without any OAuth flow in its entry point", () => {
  assert.match(mainApp, /storeCoordinatorUrl\(selected\)/);
  assert.doesNotMatch(mainApp, /authorize\(|OAuthLogin|AuthSession/);
  assert.equal(appSettings.expo.android.package, "dev.codexmobileui.app");
  assert.ok(appSettings.expo.android.versionCode > 3);
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

test("Android keeps the private coordinator, native file sink and isolated diagnostics", () => {
  assert.match(mainApp, /<DiagnosticsPanel visible=\{diagnosticsOpen\}/);
  assert.doesNotMatch(mainApp, /<OAuthLogin|<ChatView|<ChatSidebar/);
  assert.match(coordinatorStorage, /loadCoordinatorUrl/);
  assert.match(coordinatorStorage, /storeCoordinatorUrl/);
  assert.match(coordinatorStorage, /mobile_network/);
  assert.match(nativeFileSave, /Paths\.cache/);
  assert.match(nativeFileSave, /Directory\.pickDirectoryAsync\(\)/);
  assert.match(nativeFileSave, /job\.staging\.copy\(destination\)/);
  assert.match(nativeFileSave, /safePublicationFileName\(request\.name\)/);
  assert.doesNotMatch(coordinatorStorage, /CREATE TABLE IF NOT EXISTS messages/);
});

test("diagnostics save directly through a private MediaStore React Native module", () => {
  assert.match(packageSettings.scripts.preandroid, /sync-diagnostics-native\.mjs/);
  assert.match(androidStableBuild,
    /sync-diagnostics-native\.mjs[\s\S]*?Sync-Tree|\$LASTEXITCODE -ne 0 \{ throw 'Unable to synchronize native Android diagnostics\.'/);
  assert.match(diagnosticsSync, /native\/diagnostics\/DiagnosticsDownloadModule\.kt/);
  assert.match(diagnosticsSync, /add\(DiagnosticsDownloadPackage\(\)\)/);
  assert.match(diagnosticsExport, /NativeModules\.DiagnosticsDownload/);
  assert.match(diagnosticsExport, /saveJson\(fileName, JSON\.stringify\(snapshot, null, 2\)\)/);
  assert.match(diagnosticsPanel, /保存日志到下载目录/);
  assert.match(diagnosticsPanel, /role="status"/);
  assert.match(diagnosticsPanel, /role="alert"/);
  assert.doesNotMatch(diagnosticsExport + diagnosticsPanel, /expo-sharing|Sharing\.shareAsync|系统分享/);
  assert.match(diagnosticsDownload, /MediaStore\.Downloads\.getContentUri/);
  assert.match(diagnosticsDownload, /MediaStore\.Downloads\.IS_PENDING, 1/);
  assert.match(diagnosticsDownload, /resolver\.delete\(uri, null, null\)/);
  assert.match(diagnosticsDownload,
    /Build\.VERSION\.SDK_INT < Build\.VERSION_CODES\.Q[\s\S]*?WRITE_EXTERNAL_STORAGE/);
  assert.match(diagnosticsDownload,
    /RELATIVE_PATH, Environment\.DIRECTORY_DOWNLOADS\)/);
  assert.match(diagnosticsDownload,
    /arrayOf\(MediaStore\.Downloads\.DISPLAY_NAME\)[\s\S]*?actualName/);
  assert.doesNotMatch(diagnosticsSync, /AndroidManifest|WRITE_EXTERNAL_STORAGE/);
  assert.doesNotMatch(diagnosticsDownload, /WebView|injectJavaScript|addJavascriptInterface/);
});

test("diagnostics sync supports current and fresh Expo MainApplication fixtures", () => {
  const templates = [
    `class MainApplication {
  PackageList(this).packages.apply {
    // add(MyReactNativePackage())
    add(QuotaWidgetPackage())
  }
}`,
    `class MainApplication {
  PackageList(this).packages.apply {
    // Packages that cannot be autolinked yet can be added manually here.
    // add(MyReactNativePackage())
  }
}`,
    `class MainApplication {
  PackageList(this).packages.apply {
  }
}`,
  ];
  for (const source of templates) {
    const root = mkdtempSync(join(tmpdir(), "codex-diagnostics-sync-"));
    const packageRoot = join(root, "android", "app", "src", "main", "java", "dev", "codexmobileui", "app");
    try {
      mkdirSync(packageRoot, { recursive: true });
      mkdirSync(join(root, "native", "diagnostics"), { recursive: true });
      writeFileSync(join(packageRoot, "MainApplication.kt"), source);
      writeFileSync(join(root, "native", "diagnostics", "DiagnosticsDownloadModule.kt"), "module");
      syncDiagnosticsNative(root);
      syncDiagnosticsNative(root);
      const application = readFileSync(join(packageRoot, "MainApplication.kt"), "utf8");
      assert.equal(application.match(/add\(DiagnosticsDownloadPackage\(\)\)/g)?.length, 1);
      assert.equal(readFileSync(join(packageRoot, "DiagnosticsDownloadModule.kt"), "utf8"), "module");
      assert.equal(existsSync(join(root, "android", "app", "src", "main", "AndroidManifest.xml")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
