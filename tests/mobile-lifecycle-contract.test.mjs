import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const launcher = readFileSync(new URL("../scripts/mobile-shared-launcher.ps1", import.meta.url), "utf8");
const mobileStop = readFileSync(new URL("../Stop-CodexMobile.cmd", import.meta.url), "utf8");
const sharedStop = readFileSync(new URL("../shared-stop.cmd", import.meta.url), "utf8");
const appSettings = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));
const mainApp = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const diagnosticsPanel = readFileSync(new URL("../src/diagnostics/DiagnosticsPanel.tsx", import.meta.url), "utf8");
const diagnosticsExport = readFileSync(new URL("../src/diagnostics/export.ts", import.meta.url), "utf8");
const diagnosticsJournal = readFileSync(new URL("../src/diagnostics/journal.ts", import.meta.url), "utf8");
const packageSettings = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const androidStableBuild = readFileSync(new URL("../scripts/build-android-stable.ps1", import.meta.url), "utf8");

test("starting MobileUI ensures or hot-attaches to the shared App Server before Gateway startup", () => {
  assert.match(launcher, /Invoke-SharedStack "start"\s*\r?\n\s*Start-Gateway/);
  assert.match(launcher, /function Start-Gateway/);
});

test("normal MobileUI shutdown stops only Gateway, preserving shared backend", () => {
  const stopBranch = launcher.match(/if \(\$Action -eq "stop"\) \{([\s\S]*?)\}\s*else\s*\{/);
  assert.ok(stopBranch, "MobileUI launcher must have a dedicated stop branch");
  assert.match(stopBranch[1], /Stop-Gateway/);
  assert.doesNotMatch(stopBranch[1], /Invoke-SharedStack|Stop-Stack/);
  assert.match(mobileStop, /mobile-shared-launcher\.ps1" -Action stop/);
  assert.doesNotMatch(mobileStop, /shared-stack\.ps1|shared-stop\.cmd/);
});

test("explicit shared-stop remains an independent administrative action", () => {
  assert.match(sharedStop, /shared-stack\.ps1" -Action stop/);
});

test("visual app has independent Android package, no OAuth login and an offline connection test", () => {
  assert.equal(appSettings.expo.android.package, "dev.codexmobileui.visual");
  assert.ok(Number.isInteger(appSettings.expo.android.versionCode) && appSettings.expo.android.versionCode > 0);
  assert.notEqual(appSettings.expo.scheme, "codexmobileui");
  assert.match(mainApp, /const CONNECTION_TEST_HTML/);
  assert.match(mainApp, /source=\{\{ html: CONNECTION_TEST_HTML \}\}/);
  assert.match(mainApp, /loadVisualState\(\)/);
  assert.match(mainApp, /persistVisualState\(demo\)/);
  assert.doesNotMatch(mainApp, /<Login|<OAuthLogin|<CodexSession/);
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
  assert.match(androidStableBuild, /Gradle namespace\/applicationId/);
  assert.match(androidStableBuild, /Missing Kotlin entry point/);
  assert.match(androidStableBuild, /robocopy\.exe \$sourceJava \$stagedJava \/MIR/);
  assert.match(androidStableBuild, /cachedAutolinking\.project\.android\.packageName/);
  assert.match(androidStableBuild, /Remove-Item -LiteralPath \$autolinkingJson -Force/);
  assert.match(androidStableBuild, /ReactNativeApplicationEntryPoint\.java/);
  assert.match(androidStableBuild, /node_modules\\expo-modules-autolinking\\build\\index\.js/);
  assert.match(androidStableBuild, /Start-Transcript/);
  assert.match(androidStableBuild, /versionCode=/);
  assert.match(androidStableBuild, /certificate SHA-256 digest/);
  assert.match(androidStableBuild, /android-artifacts/);
});

test("device diagnostics remain available in the offline visual edition", () => {
  assert.match(mainApp, /accessibilityLabel="诊断日志"/);
  assert.match(mainApp, /<DiagnosticsPanel visible=\{diagnosticsOpen\}/);
  assert.match(mainApp, /logDiagnostic\('app\.started'/);
  assert.doesNotMatch(mainApp, /logDiagnostic\('app\.deepLinkReceived'/);
  assert.match(diagnosticsPanel, /exportDiagnostics\(\)/);
  assert.match(diagnosticsPanel, /nativeBuildVersion/);
  assert.match(mainApp, /componentDidCatch\(error: Error\)/);
  assert.match(mainApp, /diagnostics\.crashScreenPressed/);
  assert.match(diagnosticsExport, /new File\(Paths\.cache/);
  assert.match(diagnosticsExport, /Sharing\.shareAsync\(file\.uri/);
  assert.match(diagnosticsJournal, /codexmobileui-diagnostics\.db/);
  assert.match(diagnosticsJournal, /ORDER BY id DESC LIMIT/);
});
